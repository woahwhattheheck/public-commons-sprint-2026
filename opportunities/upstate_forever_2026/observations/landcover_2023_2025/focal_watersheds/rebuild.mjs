import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
const GROUPS={developed:[21,22,23,24],forest:[41,42,43],agriculture:[81,82],wetland:[90,95]};
const IDS=["030601010703","030601010704","030601020502","030601020507","030601010601","030601010602","030601010803"];
function csv(rows){const keys=Object.keys(rows[0]);const q=v=>{const s=String(v??"");return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};return keys.join(",")+"\n"+rows.map(r=>keys.map(k=>q(r[k])).join(",")).join("\n")+"\n";}
function summarize(input,pairs){
 if(input.schema!=="upstate.focal-landcover-source-selection/v1")throw Error("Unexpected selected source");
 const original=Object.fromEntries(input.annual_2023.watersheds.map(w=>[w.huc12,w])),after=Object.fromEntries(input.annual_2025.watersheds.map(w=>[w.huc12,w])),mat=Object.fromEntries(pairs.watersheds.map(w=>[w.huc12,w]));
 const area=input.method.cell_area_m2/10000,rows=[],groups=[];
 for(const huc12 of IDS){
  const a=original[huc12],b=after[huc12],m=mat[huc12];if(!a||!b||!m)throw Error("Missing HUC "+huc12);
  if(a.selected_cells!==b.selected_cells||a.selected_cells!==m.paired_valid_cells||a.nodata_cells||b.nodata_cells)throw Error("Changed support "+huc12);
  const total=m.transitions.reduce((s,t)=>s+t.cells,0),changed=m.transitions.filter(t=>t.before_class!==t.after_class).reduce((s,t)=>s+t.cells,0);
  if(total!==a.selected_cells||changed!==m.changed_class_cells)throw Error("Matrix denominator "+huc12);
  for(const cl of a.classes){const margin=m.transitions.filter(t=>t.before_class===cl.class_code).reduce((s,t)=>s+t.cells,0);if(margin!==cl.cells)throw Error("Before margin "+huc12+":"+cl.class_code);}
  for(const cl of b.classes){const margin=m.transitions.filter(t=>t.after_class===cl.class_code).reduce((s,t)=>s+t.cells,0);if(margin!==cl.cells)throw Error("After margin "+huc12+":"+cl.class_code);}
  const r={huc12,name:a.properties.name,context:IDS.indexOf(huc12)<4?"RFP focus":huc12==="030601010803"?"SV-840 current WBD unit":"Eighteenmile HUC10 component",selected_cells:total,selected_area_ha:total*area,changed_class_cells:changed,changed_class_area_ha:changed*area,changed_class_percent:100*changed/total};
  for(const [group,codes]of Object.entries(GROUPS)){
   const before=a.classes.filter(x=>codes.includes(x.class_code)).reduce((s,x)=>s+x.cells,0),next=b.classes.filter(x=>codes.includes(x.class_code)).reduce((s,x)=>s+x.cells,0);
   const loss=m.transitions.filter(t=>codes.includes(t.before_class)&&!codes.includes(t.after_class)).reduce((s,t)=>s+t.cells,0),gain=m.transitions.filter(t=>!codes.includes(t.before_class)&&codes.includes(t.after_class)).reduce((s,t)=>s+t.cells,0);
   if(next-before!==gain-loss)throw Error("Group margin "+huc12+":"+group);
   const row={huc12,name:a.properties.name,group,class_codes:codes.join(";"),before_cells:before,after_cells:next,net_cells:next-before,before_area_ha:before*area,after_area_ha:next*area,net_area_ha:(next-before)*area,gross_loss_cells:loss,gross_gain_cells:gain,gross_loss_ha:loss*area,gross_gain_ha:gain*area,before_percent:100*before/total,after_percent:100*next/total,change_percentage_points:100*(next-before)/total};groups.push(row);
   r[group+"_net_ha"]=row.net_area_ha;
   if(group==="forest"){r.forest_gross_loss_ha=row.gross_loss_ha;r.forest_gross_gain_ha=row.gross_gain_ha;}
  }
  for(const group of["forest","agriculture"]){r[group+"_to_developed_ha"]=m.transitions.filter(t=>GROUPS[group].includes(t.before_class)&&GROUPS.developed.includes(t.after_class)).reduce((s,t)=>s+t.cells,0)*area;}
  rows.push(r);
 }
 return {rows,groups,summary_csv:csv(rows),groups_csv:csv(groups)};
}
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const expected={"selected-annual-inputs.json":"5fb4cf58dde51ef1a416c2ac0f6900d2e049a73fea2ea9f5e446a5ada341983b","selected-transitions.json":"6ab17d1d944e1bc425e558f9611f4d8a6199714fc05dfd35e38f04b91ea32858"};
const read=name=>{const s=fs.readFileSync(path.join(ROOT,name),"utf8");if(createHash("sha256").update(s).digest("hex")!==expected[name])throw Error("Source hash mismatch: "+name);return JSON.parse(s);};
const result=summarize(read("selected-annual-inputs.json"),read("selected-transitions.json"));
if(process.argv.slice(2).some(a=>a!=="--check"))throw Error("Usage: node rebuild.mjs [--check]");
for(const [name,text]of Object.entries({"focal-summary.csv":result.summary_csv,"group-change.csv":result.groups_csv})){
 const filename=path.join(ROOT,name);
 if(process.argv.includes("--check")){if(fs.readFileSync(filename,"utf8")!==text)throw Error("Output differs: "+name);}
 else fs.writeFileSync(filename,text,"utf8");
}
console.log(JSON.stringify({watersheds:result.rows.length,group_rows:result.groups.length,paired_source_margins:"matched",mode:process.argv.includes("--check")?"check":"write"}));
