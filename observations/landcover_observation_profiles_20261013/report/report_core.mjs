import {buildUtilityContext} from "./utility_context.mjs";
/** Existing Observed Context consumer for the retained 217 watershed source. */
export const ROOT="observations/landcover_observation_profiles_20261013/report/";
const GROUPS=["water","snow_ice","developed","barren","forest","shrub_grass","agriculture","wetlands"];
const LABELS={water:"Water",snow_ice:"Snow / ice",developed:"Developed",barren:"Barren",forest:"Forest",shrub_grass:"Shrub / grass",agriculture:"Agriculture",wetlands:"Wetlands"};
const json=x=>JSON.stringify(x,null,2)+"\n";
const num=x=>{const n=Number(x);if(!Number.isFinite(n))throw Error("Expected retained finite number");return n};
const list=x=>JSON.parse(x);
const fmt=(x,d=2)=>num(x).toFixed(d);
const csv=rows=>{const cols=Object.keys(rows[0]);const q=x=>{const s=Array.isArray(x)?JSON.stringify(x):String(x??"");return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};return cols.map(q).join(",")+"\n"+rows.map(r=>cols.map(k=>q(r[k])).join(",")).join("\n")+"\n"};
function axes(label,unit,domain,d3){return{label,unit,domain,ticks:d3.ticks(domain[0],domain[1],5).map(value=>({value,label:String(value)}))}}
function drawFigure(figure,d3){
 const esc=x=>String(x).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
 const width=880,height=925,lines=['<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" role="img" aria-labelledby="profiles-title profiles-desc">','<title id="profiles-title">'+esc(figure.title)+'</title><desc id="profiles-desc">'+esc(figure.caption)+'</desc>','<rect width="880" height="925" fill="white"/>','<style>text{font-family:Arial,Helvetica,sans-serif;fill:#171717;font-size:12px}.title{font-size:19px;font-weight:bold}.panel{font-size:14px;font-weight:bold}.tick{font-size:11px}</style>'];
 const text=(x,y,s,a="")=>'<text x="'+x+'" y="'+y+'" '+a+'>'+esc(s)+'</text>';
 const line=(x1,y1,x2,y2,a="")=>'<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" '+a+'/>';
 const marker=(kind,x,y,size=38)=>{const open=kind.endsWith("-open"),base=kind.replace("-open",""),shape={circle:d3.symbolCircle,square:d3.symbolSquare,triangle:d3.symbolTriangle,diamond:d3.symbolDiamond,cross:d3.symbolCross}[base];if(!shape)throw Error("Unknown original marker "+kind);return'<path d="'+d3.symbol().type(shape).size(size)()+'" transform="translate('+x+','+y+')" fill="'+(open?"white":"#171717")+'" stroke="#171717" stroke-width="1"/>'};
 lines.push(text(24,30,figure.title,'class="title"'));
 for(const [i,p]of figure.panels.entries()){
  const top=107+i*412,bottom=top+274,left=115,right=850;
  const X=v=>left+(v-p.x.domain[0])/(p.x.domain[1]-p.x.domain[0])*(right-left);
  const Y=v=>bottom-(v-p.y.domain[0])/(p.y.domain[1]-p.y.domain[0])*(bottom-top);
  lines.push(text(24,top-54,p.title,'class="panel"'));
  p.series.filter(s=>s.geometry!=="line").forEach((s,j)=>{const x=34+j*208;lines.push(marker(s.marker,x,top-29,35),text(x+12,top-25,s.label));});
  for(const t of p.x.ticks){const x=X(t.value);lines.push(line(x,top,x,bottom,'stroke="#dedede" stroke-width=".8"'),text(x,bottom+21,t.label,'text-anchor="middle" class="tick"'))}
  for(const t of p.y.ticks){const y=Y(t.value);lines.push(line(left,y,right,y,'stroke="#dedede" stroke-width=".8"'),text(left-9,y+4,t.label,'text-anchor="end" class="tick"'))}
  lines.push('<rect x="'+left+'" y="'+top+'" width="'+(right-left)+'" height="'+(bottom-top)+'" fill="none" stroke="#777"/>',text((left+right)/2,bottom+45,p.x.label+(p.x.unit?" ("+p.x.unit+")":""),'text-anchor="middle"'),text(18,(top+bottom)/2,p.y.label+(p.y.unit?" ("+p.y.unit+")":""),'text-anchor="middle" transform="rotate(-90 18 '+((top+bottom)/2)+')"'));
  for(const r of p.reference_lines||[])lines.push(r.axis==="x"?line(X(r.value),top,X(r.value),bottom,'stroke="#888" stroke-dasharray="4 3"'):line(left,Y(r.value),right,Y(r.value),'stroke="#888" stroke-dasharray="4 3"'));
  for(const s of p.series){if(s.geometry==="line"){const path=d3.line().x(v=>X(v.x)).y(v=>Y(v.y))(s.points);lines.push('<path d="'+path+'" fill="none" stroke="#777" stroke-width="1" stroke-dasharray="4 3"/>');continue}
   for(const pnt of s.points){if(pnt.x<p.x.domain[0]||pnt.x>p.x.domain[1]||pnt.y<p.y.domain[0]||pnt.y>p.y.domain[1])throw Error("Plot point outside retained domains");lines.push('<g><title>'+esc((pnt.huc12?pnt.huc12+" "+pnt.name:pnt.group)+"; "+s.label+"; x="+pnt.x+"; y="+pnt.y)+'</title>'+marker(s.marker,X(pnt.x),Y(pnt.y))+'</g>')}
  }
 }
 lines.push(text(24,898,"Source classifications: 2023 and 2025. Point evidence: retained observations and South Carolina 2026 draft assessment."),text(24,916,"All 217 HUC12 rows and original coordinate variants remain linked from the report."),'</svg>');
 return lines.join("\n")+"\n";
}
export function buildProfileReport({profiles,groups,locations,summary,inputs,utilityProfile,connectivity,connectivitySummary},d3){
 if(profiles.length!==217||groups.length!==1736||locations.length!==197||summary.watershed_count!==217)throw Error("Select the complete merged 217-profile / 197-location edition");
 const ids=new Set(profiles.map(r=>r.huc12));if(ids.size!==217||profiles.some(r=>!/^\d{12}$/.test(r.huc12)))throw Error("Original HUC12 identity changed");
 const balances=GROUPS.map(group=>{const rows=groups.filter(r=>r.group===group);if(rows.length!==217)throw Error("Incomplete group "+group);const sum=k=>rows.reduce((a,r)=>a+num(r[k]),0);const r={group,label:LABELS[group],class_codes:summary.class_groups[group],area_2023_ha:sum("area_2023_ha"),area_2025_ha:sum("area_2025_ha"),gross_gain_ha:sum("gross_gain_ha"),gross_loss_ha:sum("gross_loss_ha"),net_change_ha:sum("net_change_ha")};if(Math.abs(r.gross_gain_ha-r.gross_loss_ha-r.net_change_ha)>1e-6)throw Error("Group mass balance differs");return r});
 const defs=[{key:"neither",label:"Neither (152)",marker:"circle-open"},{key:"assessment",label:"Assessment (44)",marker:"square-open"},{key:"flow",label:"Flow gauge (16)",marker:"triangle-open"},{key:"both",label:"Both (5)",marker:"diamond"}];
 const points=profiles.map(r=>({huc12:r.huc12,name:r.name,x:num(r.forest_gross_loss_ha),y:num(r.forest_gross_gain_ha),local_evidence_class:+r.draft2026_assessment_station_count?(+r.local_observed_flow_gauge_count?"both":"assessment"):(+r.local_observed_flow_gauge_count?"flow":"neither"),draft_assessment_station_count:+r.draft2026_assessment_station_count,local_observed_flow_gauge_count:+r.local_observed_flow_gauge_count}));
 const expected={neither:152,assessment:44,flow:16,both:5};for(const d of defs)if(points.filter(p=>p.local_evidence_class===d.key).length!==expected[d.key])throw Error("Local evidence cohort changed");
 const areaMax=Math.ceil(d3.max(balances,r=>Math.max(r.gross_gain_ha,r.gross_loss_ha))/5000)*5000;
 const forestMax=Math.ceil(d3.max(points,r=>Math.max(r.x,r.y))/100)*100;
 const figure={id:"regional-classification-and-point-evidence",title:"Regional land-cover balances and retained point evidence",caption:"Panel A accounts for all 217 HUC12s using original cell-centre inclusion: gains enter a class group, losses leave it, and net equals 2025 minus 2023. Negative loss marks are a plotting convention. Panel B shows each watershed's gross forest-class loss and gain; the diagonal is equal gain and loss. Marker classes describe local retained point membership only: South Carolina 2026 draft assessment sites and gauges with retained flow observations. They do not describe the upstream area observed by a gauge, monitoring completeness, or causal relationships between classification changes and water quality. All 217 watersheds are included.",panels:[
 {title:"A. Whole-domain between-group balances",x:axes("Area entering (+), leaving (−), or net change","ha",[-areaMax,areaMax],d3),y:{label:"Class group",unit:"",domain:[-.5,7.5],ticks:balances.map((r,i)=>({value:i,label:r.label}))},series:[
 {label:"Gain",geometry:"scatter",marker:"square",points:balances.map((r,i)=>({x:r.gross_gain_ha,y:i+.16,group:r.group}))},
 {label:"Loss",geometry:"scatter",marker:"triangle-open",points:balances.map((r,i)=>({x:-r.gross_loss_ha,y:i-.16,group:r.group}))},
 {label:"Net",geometry:"scatter",marker:"circle-open",points:balances.map((r,i)=>({x:r.net_change_ha,y:i,group:r.group}))}],reference_lines:[{axis:"x",value:0,label:"Zero"}]},
 {title:"B. Forest-class gross loss and gain by HUC12",x:axes("Gross forest-class loss","ha",[-forestMax*.015,forestMax*1.02],d3),y:axes("Gross forest-class gain","ha",[-forestMax*.015,forestMax*1.02],d3),series:[{label:"Equal gain / loss",geometry:"line",markers:false,points:[{x:0,y:0},{x:forestMax,y:forestMax}]},...defs.map(d=>({label:d.label,geometry:"scatter",marker:d.marker,points:points.filter(p=>p.local_evidence_class===d.key)}))],reference_lines:[]}
 ]};
 const table=(columns,rows,widths)=>({kind:"table",columns,rows,...(widths?{widths}: {})});
 const focus=["030601010703","030601010704","030601020502","030601020507","030601010601","030601010602","030601010803"].map(id=>profiles.find(r=>r.huc12===id));
 const both=profiles.filter(r=>+r.draft2026_assessment_station_count&&+r.local_observed_flow_gauge_count);
 const selected=profiles.filter(r=>+r.draft2026_assessment_station_count).sort((a,b)=>num(b.developed_net_change_ha)-num(a.developed_net_change_ha)||(a.huc12<b.huc12?-1:1)).slice(0,10);
 const arr=x=>list(x).join(", ")||"None retained";
 const recipe={schema:"upstate.observed-report/v1",edition:"regional-profile-report-20261013-v2",title:"217 watershed land-cover, utility geography and dated observation context",inputs,sections:[
 ["Scope and source dates",[
 "The retained hydrologic domain contains 217 HUC12 watersheds. The original 2023 and 2025 classification rasters select "+summary.selected_cells.toLocaleString("en-US")+" common cell centres over "+fmt(summary.area_ha)+" ha. A total of "+summary.changed_cells.toLocaleString("en-US")+" cells ("+fmt(summary.changed_percent,4)+"%; "+fmt(summary.changed_area_ha)+" ha) changed class. Original-cell classifications and this footprint are retained in the source edition.",
 "The observation overlay preserves 197 original coordinate variants and their current official WBD point queries: 183 lie in the land-cover domain and 14 lie outside. Physical gauge identities are deduplicated within a HUC12 while original agency and indexed network coordinate alternatives remain available. The 87 assessment sites belong to the South Carolina 2026 draft list, independently dated from the 2023/2025 classifications.",
 "This report uses local point membership to organize the retained evidence. A gauge's upstream basin, source-period measurement coverage, and the state assessment program answer different questions. Use the retained whole-catchment source and dated observations for those comparisons; a HUC12 without a retained listed point is not classified here as unimpaired or unmonitored."
 ]],
 ["Whole-domain class accounting",[table(["Group","2023 ha","2025 ha","Gain ha","Loss ha","Net ha"],balances.map(r=>[r.label,fmt(r.area_2023_ha),fmt(r.area_2025_ha),fmt(r.gross_gain_ha),fmt(r.gross_loss_ha),fmt(r.net_change_ha)])),
 "Gross gains and losses count transitions across the eight displayed groups. Changes among forest classes 41, 42 and 43 contribute to the all-class changed-cell total but do not cross the forest-group boundary. Developed includes class 21, developed open space; its area is not equivalent to impervious area. Net area is 2025 minus 2023. These are differences in the source classifications; they do not date individual land-management events."
 ]],
 ["Local retained evidence by watershed",[table(["Local retained point category","HUC12 count"],[["Draft assessment and observed-flow gauge","5"],["Draft assessment only","44"],["Observed-flow gauge only","16"],["Neither selected category","152"]]),
 "There are 87 draft assessment sites in 49 HUC12s and 22 unique gauges with retained flow observations in 21 HUC12s. The five HUC12s containing both categories are listed below. The retained inventory also contains other gauge roles, lake-study sites and permit/outfall points; 'neither' refers only to the two categories used in this figure.",
 table(["HUC12 / name","Draft site IDs / causes","Retained flow gauge IDs"],both.map(r=>[r.huc12+"\n"+r.name,arr(r.draft2026_assessment_station_ids)+"\n"+arr(r.draft2026_listed_causes),arr(r.local_observed_flow_gauge_ids)]))
 ]],
 ["Four focus watersheds and the Eighteenmile lake-study setting",[
 table(["HUC12 / name","Changed %","Developed net ha","Forest loss / gain ha","Draft cause codes"],focus.map(r=>[r.huc12+"\n"+r.name,fmt(r.changed_class_percent),fmt(r.developed_net_change_ha),fmt(r.forest_gross_loss_ha)+" / "+fmt(r.forest_gross_gain_ha),arr(r.draft2026_listed_causes)])),
 "The first four rows are the four RFP focus HUC12s; the next two are Upper and Lower Eighteenmile Creek. The last is Upper Seneca River, the current official HUC12 containing the original SV-840 open-lake coordinate. SV-840 remains in the original five-site study cohort even though that coordinate is outside the report's Eighteenmile study HUC10 0306010106.",
 "Cause codes retain the source's separate assessment meaning. Nutrient and sediment model outputs should be compared with relevant nitrogen, phosphorus or sediment observations; E. coli, biological condition, pH, metals and fish-tissue PCB listings require their own evidence and processes. The profile association supplies a review location, not a modeled explanation for an impairment.",
 "Lower Tugaloo illustrates why net change alone is incomplete: gross forest-class loss and gain can nearly offset. The full transition tables preserve both directions and all 16 original classes."
 ]],
 ["Review locations ordered by developed-class net gain",[
 "This descriptive table selects the ten HUC12s with the greatest developed-class net area gain among the 49 HUC12s containing a retained 2026 draft assessment point. It is an explicit physical ordering for review, not a pollution ranking or an attribution of any listed cause.",
 table(["HUC12 / name","Developed net ha","Forest loss / gain ha","Draft sites","Causes"],selected.map(r=>[r.huc12+"\n"+r.name,fmt(r.developed_net_change_ha),fmt(r.forest_gross_loss_ha)+" / "+fmt(r.forest_gross_gain_ha),arr(r.draft2026_assessment_station_ids),arr(r.draft2026_listed_causes)]))
 ]],
 ["Original geographic and assessment identities",[
 "Each original location row keeps the coordinate system and variant, current official HUC12, listed HUC12, draft/July TMDL HUC fields, agency GIS HUC, published HUC8/HUC10, study-scope HUC10 and the corresponding comparison fields. Per-cause assessment priorities, TMDL cause context and July use-support remain separate source fields. IDs retain leading zeros.",
 "RS-06190 illustrates a source distinction retained in the data: its current/listed HUC12 is 030601030602 while the draft/July TMDL HUC field is 030601030502. The report does not silently replace either field. The 14 outside-domain coordinate variants remain in the source tables as regional context.",
 {kind:"links",items:[{title:"All 217 watershed profiles",path:"observations/landcover_observation_profiles_20261013/watershed-profiles.csv"},{title:"All 1,736 group balances",path:"observations/landcover_observation_profiles_20261013/landcover-groups.csv"},{title:"All 197 original-coordinate identities and source URLs",path:"observations/landcover_observation_profiles_20261013/original-location-context.csv"},{title:"Original source methodology and factual scope",path:"observations/landcover_observation_profiles_20261013/README.md"},{title:"All 55,552 class transitions",path:"observations/landcover_2023_2025/huc12-transitions.csv"},{title:"Figure points and exact local-evidence category",path:ROOT+"forest-point-evidence.csv"},{title:"Whole-domain group balances",path:ROOT+"domain-group-balances.csv"}]}
 ]]
 ],figure_spec:ROOT+"figure-spec.json",figures:[{id:figure.id,path:ROOT+"regional-classification-and-point-evidence.svg"}],source_links:inputs.map(r=>r.path)};
 const utility=buildUtilityContext({profiles,groups,locations,utilityProfile,connectivity,connectivitySummary},d3);
 recipe.sections.splice(4,0,utility.section);
 recipe.sections.at(-1)[1].at(-1).items.push(
  {title:"Utility anchors, reconstructed upstream unions and original memberships",path:ROOT+"utility-context.json"},
  {title:"Four utility footprint summaries",path:ROOT+"utility-scope-summary.csv"},
  {title:"All 32 utility footprint / class-group balances",path:ROOT+"utility-group-balances.csv"},
  {title:"Original issuer utility anchor definition",path:"source/receptor-topology/20261013/utility-focus-profile.json"},
  {title:"Original 217-watershed network and ancestor lists",path:"outputs/watershed-connectivity-20261013/watershed-connectivity-217.csv"}
 );
 recipe.figures.push({id:utility.figure.id,path:ROOT+"utility-focus-upstream-context.svg"});
 return{
  [ROOT+"utility-context.json"]:json(utility.summary),
  [ROOT+"utility-scope-summary.csv"]:csv(utility.scopes),
  [ROOT+"utility-group-balances.csv"]:csv(utility.groupRows),
  [ROOT+"utility-focus-upstream-context.svg"]:drawFigure(utility.figure,d3),
  [ROOT+"scientific-context.json"]:json(recipe),
  [ROOT+"figure-spec.json"]:json({schema:"upstate.scientific-figure-spec/v1",title:figure.title,figures:[figure,utility.figure]}),
  [ROOT+"regional-classification-and-point-evidence.svg"]:drawFigure(figure,d3),
  [ROOT+"forest-point-evidence.csv"]:csv(points),
  [ROOT+"domain-group-balances.csv"]:csv(balances)
 };
}
