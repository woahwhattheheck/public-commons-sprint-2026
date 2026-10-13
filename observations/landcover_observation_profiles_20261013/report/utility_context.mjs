/** Utility focus and distinct upstream-union context from original ToHUC links. */
const GROUPS=["water","snow_ice","developed","barren","forest","shrub_grass","agriculture","wetlands"];
const number=v=>{const n=Number(v);if(!Number.isFinite(n))throw Error("Expected finite original value");return n};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const unique=xs=>[...new Set(xs)].sort(cmp);
const parsed=v=>Array.isArray(v)?v:JSON.parse(v);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fmt=(v,d=2)=>number(v).toFixed(d);
export function buildUtilityContext({profiles,groups,locations,utilityProfile,connectivity,connectivitySummary},d3){
 if(utilityProfile.schema!=="upstate.receptor-spec/v1"||connectivitySummary.schema!=="upstate.watershed-connectivity/v1"||connectivitySummary.domain_huc_count!==217||connectivitySummary.cycles?.length||connectivitySummary.native_rows_missing?.length)throw Error("Select the complete original acyclic connectivity edition");
 const byId=new Map(profiles.map(r=>[r.huc12,r])),net=new Map(connectivity.map(r=>[r.huc12,r]));
 if(byId.size!==217||net.size!==217||[...net.keys()].some(id=>!byId.has(id)))throw Error("Original network and profile HUC12 sets differ");
 const reverse=new Map([...net.keys()].map(id=>[id,[]]));
 for(const r of connectivity)if(net.has(r.native_downstream_huc12))reverse.get(r.native_downstream_huc12).push(r.huc12);
 function closure(id){
  if(!net.has(id))throw Error("Utility anchor absent from original network");
  const found=new Set(),active=new Set();
  function visit(h){if(active.has(h))throw Error("Cycle in original ToHUC network");if(found.has(h))return;active.add(h);found.add(h);for(const p of reverse.get(h))visit(p);active.delete(h)}
  visit(id);
  const up=unique([...found].filter(h=>h!==id)),row=net.get(id),declared=unique(String(row.upstream_huc12s||"").split("|").filter(Boolean));
  if(!same(up,declared)||up.length!==number(row.upstream_domain_huc_count)||found.size!==number(row.contributing_huc_count))throw Error("Replayed ToHUC ancestry differs from retained source");
  if(number(row.known_external_upstream_huc_count)!==0)throw Error("Utility source reports an external upstream contribution");
  return unique([...found]);
 }
 function aggregate(huc12s){
  const set=new Set(huc12s),rows=huc12s.map(id=>byId.get(id));
  const sum=k=>rows.reduce((a,r)=>a+number(r[k]),0);
  const selected_cells=sum("selected_cells"),changed_cells=sum("changed_class_cells");
  const balance=GROUPS.map(group=>{
   const rs=groups.filter(r=>set.has(r.huc12)&&r.group===group);
   if(rs.length!==huc12s.length)throw Error("Incomplete utility group members");
   const total=k=>rs.reduce((a,r)=>a+number(r[k]),0);
   const v={group,class_codes:parsed(rs[0].class_codes),area_2023_ha:total("area_2023_ha"),area_2025_ha:total("area_2025_ha"),gross_gain_ha:total("gross_gain_ha"),gross_loss_ha:total("gross_loss_ha"),net_change_ha:total("net_change_ha")};
   if(Math.abs(v.gross_gain_ha-v.gross_loss_ha-v.net_change_ha)>1e-6||Math.abs(v.area_2025_ha-v.area_2023_ha-v.net_change_ha)>1e-6)throw Error("Utility group balance does not reconcile");
   return v;
  });
  const area=sum("area_ha");
  for(const field of ["area_2023_ha","area_2025_ha"])if(Math.abs(balance.reduce((a,r)=>a+r[field],0)-area)>1e-6)throw Error("Utility group areas do not span the selected cells");
  return{huc12s,watershed_count:huc12s.length,area_ha:area,selected_cells,changed_cells,changed_area_ha:sum("changed_class_area_ha"),changed_percent:100*changed_cells/selected_cells,assessment_station_ids:unique(rows.flatMap(r=>parsed(r.draft2026_assessment_station_ids))),local_flow_gauge_ids:unique(rows.flatMap(r=>parsed(r.local_observed_flow_gauge_ids))),original_coordinate_variants:locations.filter(r=>set.has(r.current_huc12)).length,groups:balance};
 }
 const receptors=utilityProfile.receptors;
 if(receptors.length!==2||!same(unique(receptors.map(r=>r.utility_id)),["ARJWS","PRWD"]))throw Error("Select the issuer's original two utility anchor definitions");
 const utilities=receptors.map(r=>{
  const anchors=unique(r.anchor_huc12s);
  if(anchors.length!==2||anchors.some(h=>!/^\d{12}$/.test(h)))throw Error("Original utility anchors differ");
  const each=anchors.map(h=>({huc12:h,...aggregate(closure(h))}));
  const union=unique(each.flatMap(x=>x.huc12s)),contributing_union=aggregate(union);
  const occurrences=new Map();for(const x of each)for(const h of x.huc12s)occurrences.set(h,(occurrences.get(h)||0)+1);
  const repeated_members=unique([...occurrences].filter(([,n])=>n>1).map(([h])=>h));
  const sum_individual_contributing_ha=each.reduce((a,x)=>a+x.area_ha,0);
  const repeated_area_ha=sum_individual_contributing_ha-contributing_union.area_ha;
  const replay= [...occurrences].reduce((a,[h,n])=>a+(n-1)*number(byId.get(h).area_ha),0);
  if(Math.abs(repeated_area_ha-replay)>1e-6)throw Error("Utility shared-ancestor correction differs");
  return{id:r.id,utility_id:r.utility_id,title:r.title,reference:r.reference,selected:aggregate(anchors),contributing_union,individual_focal:each,sum_individual_contributing_ha,repeated_area_ha,repeated_members};
 });
 const scopes=utilities.flatMap(u=>[["selected",u.selected],["contributing_union",u.contributing_union]].map(([scope,a])=>({utility_id:u.utility_id,scope,huc12s:a.huc12s,watershed_count:a.watershed_count,area_ha:a.area_ha,selected_cells:a.selected_cells,changed_cells:a.changed_cells,changed_area_ha:a.changed_area_ha,changed_percent:a.changed_percent,assessment_station_ids:a.assessment_station_ids,local_flow_gauge_ids:a.local_flow_gauge_ids,original_coordinate_variants:a.original_coordinate_variants})));
 const groupRows=utilities.flatMap(u=>[["selected",u.selected],["contributing_union",u.contributing_union]].flatMap(([scope,a])=>a.groups.map(g=>({utility_id:u.utility_id,scope,huc12s:a.huc12s,...g}))));
 const summary={schema:"upstate.utility-profile-context/v1",source_years:[2023,2025],assessment_edition:"South Carolina 2026 draft",geography:"Issuer whole-HUC12 anchor sets and distinct upstream unions from retained original ToHUC links; full native cell-centre area",methods:"Recompute upstream ancestry from native_downstream_huc12 and compare exact retained ancestor lists/counts. Aggregate each selected HUC12 once. Deduplicate physical gauge and assessment-site IDs while preserving original coordinate variants.",utilities};
 const table=(columns,rows)=>({kind:"table",columns,rows});
 const group=(a,key)=>a.groups.find(g=>g.group===key);
 const section=["Utility focus watersheds and their complete upstream unions",[
 "The issuer names two focus watersheds for ARJWS and two for PRWD. Their retained original ToHUC links define distinct upstream unions of four and 32 HUC12s respectively. These are whole-HUC12 contributing-land planning extents. They retain the full upstream domain across state boundaries and differ from a utility service area, an intake-point delineation, and the South Carolina reporting mask.",
 table(["Utility / scope","HUC12s","Native area ha","Changed %","Developed net ha","Forest net ha"],utilities.flatMap(u=>[["Focus anchors",u.selected],["Unique upstream union",u.contributing_union]].map(([label,a])=>[u.utility_id+" / "+label,String(a.watershed_count),fmt(a.area_ha),fmt(a.changed_percent,4),fmt(group(a,"developed").net_change_ha),fmt(group(a,"forest").net_change_ha)]))),
 "ARJWS's upstream union includes the full Upper and Lower Six and Twenty Creek focus pair plus its two other upstream HUC12s. PRWD's Lower Tugaloo anchor contains the Choestoea anchor within its upstream union. The increased footprint changes both absolute area balances and the denominator of the changed-class percentage; a smaller union-wide percentage can coexist with a larger changed area.",
 table(["Utility","Sum of per-anchor upstream areas ha","Distinct union ha","Repeated area removed ha","Repeated HUC12"],utilities.map(u=>[u.utility_id,fmt(u.sum_individual_contributing_ha),fmt(u.contributing_union.area_ha),fmt(u.repeated_area_ha),u.repeated_members.join(", ")])),
 "Simply adding the upstream totals of both anchors counts shared land twice. The calculation traverses the original directed links, checks each reconstructed ancestor list against the retained connectivity table, and counts each HUC12 once. All four original anchor records report zero known external upstream HUCs in this source edition.",
 table(["Utility / scope","2026 draft assessment sites","Retained flow gauges","Original coordinate variants"],utilities.flatMap(u=>[["Focus anchors",u.selected],["Unique upstream union",u.contributing_union]].map(([label,a])=>[u.utility_id+" / "+label,String(a.assessment_station_ids.length),String(a.local_flow_gauge_ids.length),String(a.original_coordinate_variants)]))),
 "PRWD's selected anchors contain two retained draft assessment sites and no retained observed-flow gauge points; its upstream union contains 16 such assessment sites and six distinct observed-flow gauges. ARJWS's counts change from two to five assessment sites and remain at zero retained observed-flow gauge points. These are local point inventories inside each footprint, not a claim that the union is fully measured or that gauges observe only these selected areas.",
 "The full eight-group balances retain gross gains and losses as well as net changes. Forest-class gain and loss can offset; developed includes class 21 open space and is not an impervious-area measurement. The original 2023/2025 classification comparison describes source classes, while the dated assessment and flow inventories provide separate review context."
 ]];
 const ax=(label,unit,domain)=>({label,unit,domain,ticks:d3.ticks(domain[0],domain[1],5).map(value=>({value,label:String(value)}))});
 const areaMax=Math.ceil(d3.max(scopes,r=>r.area_ha)/50000)*50000;
 const forestRows=utilities.flatMap(u=>[["Focus",u.selected],["Upstream union",u.contributing_union]].map(([label,a])=>({label:u.utility_id+" "+(label==="Focus"?"anchors":"union"),...group(a,"forest")})));
 const forestMax=Math.ceil(d3.max(forestRows,r=>Math.max(r.gross_gain_ha,r.gross_loss_ha))/200)*200;
 const figure={id:"utility-focus-upstream-context",title:"Utility focus areas and distinct upstream context",caption:"Panel A compares each issuer focus pair with its unique original-network upstream union using the same native-cell area. The union includes the anchors. Panel B preserves gross forest-class gains, losses and net change for those four footprints; negative loss marks are a plotting convention. Whole-HUC12 planning extents are distinct from intake-point catchments and service areas. Source classifications are 2023 and 2025; the source table records original network memberships and all eight group balances.",panels:[
  {title:"A. Focal anchors versus unique contributing land",x:ax("Native classified area","ha",[-areaMax*.02,areaMax]),y:{label:"Utility",unit:"",domain:[-.5,1.5],ticks:utilities.map((u,i)=>({value:i,label:u.utility_id}))},series:[
   {label:"Focus anchors",geometry:"scatter",marker:"circle-open",points:utilities.map((u,i)=>({x:u.selected.area_ha,y:i,group:u.utility_id+" focus anchors"}))},
   {label:"Upstream union",geometry:"scatter",marker:"diamond",points:utilities.map((u,i)=>({x:u.contributing_union.area_ha,y:i,group:u.utility_id+" distinct upstream union"}))}],reference_lines:[{axis:"x",value:0,label:"Zero"}]},
  {title:"B. Forest-class gains, losses and net changes",x:ax("Area entering (+), leaving (−), or net change","ha",[-forestMax,forestMax]),y:{label:"",unit:"",domain:[-.5,3.5],ticks:forestRows.map((r,i)=>({value:i,label:r.label}))},series:[
   {label:"Gain",geometry:"scatter",marker:"square",points:forestRows.map((r,i)=>({x:r.gross_gain_ha,y:i+.15,group:r.label}))},
   {label:"Loss",geometry:"scatter",marker:"triangle-open",points:forestRows.map((r,i)=>({x:-r.gross_loss_ha,y:i-.15,group:r.label}))},
   {label:"Net",geometry:"scatter",marker:"circle-open",points:forestRows.map((r,i)=>({x:r.net_change_ha,y:i,group:r.label}))}],reference_lines:[{axis:"x",value:0,label:"Zero"}]}
 ]};
 return{summary,scopes,groupRows,section,figure};
}
