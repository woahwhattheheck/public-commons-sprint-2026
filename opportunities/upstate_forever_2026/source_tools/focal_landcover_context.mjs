import {createArchiveCodec} from "./archive_codec.mjs";
const codec=createArchiveCodec();
const PINS={
  "selected-annual-inputs.json": {
    "bytes": 58404,
    "sha256": "5fb4cf58dde51ef1a416c2ac0f6900d2e049a73fea2ea9f5e446a5ada341983b"
  },
  "selected-transitions.json": {
    "bytes": 252542,
    "sha256": "6ab17d1d944e1bc425e558f9611f4d8a6199714fc05dfd35e38f04b91ea32858"
  },
  "focal-summary.csv": {
    "bytes": 2168,
    "sha256": "ae4cf489f6f9861f072a740cdf82bac11b4ee01a3dc19e1e7729239e7cb43470"
  },
  "group-change.csv": {
    "bytes": 6537,
    "sha256": "532c65c70a9f234f839ee81586a9817e623e90485d7371fd53c51632a897555d"
  },
  "rebuild.mjs": {
    "bytes": 4877,
    "sha256": "119b37e8e5f93f0c5ebf6b8863023a58a4767f57b55f961483b6278967c6d6af"
  },
  "README.md": {
    "bytes": 5633,
    "sha256": "13d909a201326aacd0e90cca6b17d166475232ee6552e8d762a150fe7c433ff6"
  },
  "model-sources.json": {
    "bytes": 3418,
    "sha256": "4d34a4928b6f5d4fbc18991ebc92d4e7ae64cf1edb3b0696dbaaa471eed4d057"
  }
};
const PARENT_PINS={
  "annual-2023.json": {
    "bytes": 477495,
    "sha256": "1e4bea16ffb1ccaf8361972a042bb2b71a2320b36aea069d9a2282954e005836"
  },
  "annual-2025.json": {
    "bytes": 477860,
    "sha256": "21a9d49dc2811778ef86d5bd05114530e52bdd2cabb60e8eb4857dd8fd40adc8"
  },
  "transitions-2023-2025.json": {
    "bytes": 5892411,
    "sha256": "c1813390a4884b54cf878817c58ac91abc0dc8a5c1571765a034926252dc672a"
  },
  "huc12-change-summary.csv": {
    "bytes": 23193,
    "sha256": "6d703c75b24eb9dc38a1d868bcd0b43e976e6e94bbb7a8eeef25bf69328c4bec"
  },
  "model-sources.json": {
    "bytes": 6924,
    "sha256": "15596485b8044a60edfbdaefe39dd8987f550fc5e1c6289edc26a2bec063b9f5"
  }
};

const IDS=["030601010703","030601010704","030601020502","030601020507","030601010601","030601010602","030601010803"];
const GROUPS={developed:[21,22,23,24],forest:[41,42,43],agriculture:[81,82],wetland:[90,95]};
const CODES=[11,12,21,22,23,24,31,41,42,43,52,71,81,82,90,95];
const TITLE="Priority watershed land-cover interpretation, 2023–2025";
const VINTAGE="Original Annual NLCD product years 2023 and 2025; captured 2026-10-13";
const URI="https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms";
const json=x=>JSON.stringify(x,null,2)+"\n";
const bytes=x=>typeof x==="string"?codec.utf8Encode(x):x instanceof Uint8Array?x:null;
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const n=(x,d=2)=>x===null?"No paired-valid area":Number(x).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const signed=x=>(x>0?"+":"")+n(x);
const table=(columns,rows,widths)=>({kind:"table",columns,rows,...(widths?{widths}:{})});
function requireIt(ok,label){if(!ok)throw Error(label);}
function eq(a,b,label){requireIt(a===b,label);}
function canonical(x){return JSON.stringify(x===null||typeof x!=="object"?x:Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])));}
function same(a,b,label){eq(canonical(a),canonical(b),label);}
function close(a,b,label){requireIt(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*1e-12),label);}
function descriptor(path,body){return{path,bytes:body.length,sha256:codec.sha256(body)};}
function retain(files,pins,prefix=""){
 const result={};
 for(const [name,pin] of Object.entries(pins)){
  const body=bytes(files?.[name]);requireIt(body,"Missing complete source "+name);
  eq(body.length,pin.bytes,"Original byte count: "+name);eq(codec.sha256(body),pin.sha256,"Original SHA256: "+name);
  result[prefix+name]=body;
 }
 return result;
}
function csvRows(text){
 let rows=[],row=[],cell="",quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}
  else if(c==='"'){requireIt(cell==="","Malformed original CSV quoting");quoted=true;}
  else if(c===","){row.push(cell);cell="";}
  else if(c==="\n"){row.push(cell);rows.push(row);row=[];cell="";}
  else if(c!=="\r")cell+=c;
 }requireIt(!quoted,"Incomplete original CSV");if(cell||row.length){row.push(cell);rows.push(row);}
 const headers=rows.shift();requireIt(headers&&new Set(headers).size===headers.length,"Original CSV columns");
 return rows.filter(r=>r.some(x=>x!=="")).map(r=>{eq(r.length,headers.length,"Original CSV row width");return Object.fromEntries(headers.map((k,i)=>[k,r[i]]));});
}
function csv(rows){const cols=Object.keys(rows[0]);const q=x=>{const s=String(x??"");return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};return cols.join(",")+"\n"+rows.map(r=>cols.map(k=>q(r[k])).join(",")).join("\n")+"\n";}
function index(rows,key,label){const m=new Map();for(const r of rows){const k=key(r);requireIt(!m.has(k),"Duplicate "+label+" "+k);m.set(k,r);}return m;}
function numeric(row,skip){return Object.fromEntries(Object.entries(row).map(([k,v])=>{if(skip.includes(k))return[k,v];const z=Number(v);requireIt(v!==""&&Number.isFinite(z),"Missing original numeric field "+k);return[k,z];}));}
function figureSpec(groups,rows,inputs){
 const panels=Object.entries(GROUPS).map(([group,codes])=>{
  const data=IDS.map(id=>groups.find(r=>r.huc12===id&&r.group===group));
  const raw=data.flatMap(r=>[r.gross_loss_ha,r.gross_gain_ha,r.net_area_ha]);
  const lo=Math.min(0,...raw),hi=Math.max(0,...raw),span=hi-lo||1;
  const a=lo-span*.07,b=hi+span*.07,ticks=Array.from({length:5},(_,i)=>({value:a+(b-a)*i/4,label:n(a+(b-a)*i/4,1)}));
  return{id:group,title:group[0].toUpperCase()+group.slice(1)+" — gross crossings and net balance",
   x:{domain:[0.5,7.5],label:"Watershed number (key below)",unit:"",ticks:IDS.map((id,i)=>({value:i+1,label:String(i+1)}))},
   y:{domain:[a,b],label:"Area",unit:"ha",ticks},
   reference_lines:[{axis:"y",value:0}],
   series:[["Gross loss","gross_loss_ha","circle-open"],["Gross gain","gross_gain_ha","square"],["Net change","net_area_ha","diamond"]].map(([label,key,marker])=>({label,geometry:"scatter",marker,points:data.map((r,i)=>({x:i+1,y:r[key],huc12:r.huc12,source_row:groups.indexOf(r)+2,source_path:"group-change.csv",quantity:key}))})),
   source_definition:{group,class_codes:codes,gross_loss:"Crossings from group to other classes",gross_gain:"Crossings from other classes into group",net:"Later minus earlier = gross gain minus gross loss"}};
 });
 return{id:"focal-landcover-gross-net",title:TITLE,caption:"Original CSV areas. Open circles = gross loss; filled squares = gross gain; diamonds = net change. Positive gross loss is an area crossing out, not a signed net value. Panels use their own labelled vertical scales. Watersheds 1–4 are the RFP focus; 5–6 are the Eighteenmile HUC10 components; 7 is separate Upper Seneca. Source classes and spatial support remain unchanged.",inputs,panels,watershed_key:rows.map((r,i)=>({number:i+1,huc12:r.huc12,name:r.name,context:r.context}))};
}
function renderFigure(figure){
 const W=1100,H=820,pw=540,ph=360,parts=[];
 figure.panels.forEach((p,i)=>{
  const ox=10+(i%2)*550,oy=40+Math.floor(i/2)*385,L=62,R=18,T=37,B=61;
  const X=x=>ox+L+(x-p.x.domain[0])/(p.x.domain[1]-p.x.domain[0])*(pw-L-R);
  const Y=y=>oy+ph-B-(y-p.y.domain[0])/(p.y.domain[1]-p.y.domain[0])*(ph-T-B);
  parts.push('<g><text x="'+(ox+L)+'" y="'+(oy+17)+'" font-size="13" font-weight="600">'+esc(p.title)+'</text>');
  for(const t of p.y.ticks)parts.push('<line x1="'+(ox+L)+'" x2="'+(ox+pw-R)+'" y1="'+Y(t.value)+'" y2="'+Y(t.value)+'" stroke="#ddd"/><text x="'+(ox+L-8)+'" y="'+(Y(t.value)+4)+'" text-anchor="end" font-size="11">'+esc(t.label)+'</text>');
  parts.push('<line x1="'+(ox+L)+'" x2="'+(ox+pw-R)+'" y1="'+Y(0)+'" y2="'+Y(0)+'" stroke="#777" stroke-dasharray="4 3"/>');
  for(const t of p.x.ticks)parts.push('<text x="'+X(t.value)+'" y="'+(oy+ph-B+20)+'" text-anchor="middle" font-size="12">'+esc(t.label)+'</text>');
  parts.push('<text x="'+(ox+L)+'" y="'+(oy+ph-14)+'" font-size="11">Watershed number • area in hectares</text>');
  for(const [si,s] of p.series.entries())for(const pt of s.points){
   const x=X(pt.x),y=Y(pt.y),title=esc(s.label+" | "+pt.huc12+" | "+n(pt.y,4)+" ha"),r=4;
   parts.push('<g><title>'+title+'</title>');
   if(si===0)parts.push('<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="white" stroke="#111" stroke-width="1.4"/>');
   else if(si===1)parts.push('<rect x="'+(x-r)+'" y="'+(y-r)+'" width="8" height="8" fill="#333"/>');
   else parts.push('<polygon points="'+x+','+(y-r-1)+' '+(x+r+1)+','+y+' '+x+','+(y+r+1)+' '+(x-r-1)+','+y+'" fill="#777" stroke="#111" stroke-width=".7"/>');
   parts.push('</g>');
  }parts.push('</g>');
 });
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-labelledby="title desc"><title id="title">'+esc(TITLE)+'</title><desc id="desc">'+esc(figure.caption)+'</desc><rect width="1100" height="820" fill="white"/><g fill="#111" font-family="Arial, sans-serif"><text x="72" y="21" font-size="13">○ Gross loss    ■ Gross gain    ◆ Net change — exact original areas</text>'+parts.join("")+'</g></svg>\n';
}
function renderTable(t,label){
 return '<div class="table-scroll" role="region" aria-label="'+esc(label+' table; scroll horizontally for all columns')+'" tabindex="0"><table><thead><tr>'+t.columns.map(x=>'<th scope="col">'+esc(x)+'</th>').join("")+'</tr></thead><tbody>'+t.rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(x)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
}
function figureHTML(figure,svg){
 const panels=figure.panels.map((p,i)=>{
  const prefix="focal-panel-"+i,box=((i%2)*550)+" "+(35+Math.floor(i/2)*385)+" 550 385";
  const panel=svg.replace('viewBox="0 0 1100 820"','viewBox="'+box+'"')
   .replace('aria-labelledby="title desc"','aria-labelledby="'+prefix+'-title '+prefix+'-desc"')
   .replace('id="title"','id="'+prefix+'-title"').replace('id="desc"','id="'+prefix+'-desc"');
  return '<div class="figure-panel"><p class="panel-key">○ Gross loss &nbsp; ■ Gross gain &nbsp; ◆ Net change · hectares</p><div class="figure-scroll panel-scroll" role="region" aria-label="'+esc(p.title+'; original figure panel; scroll horizontally if needed')+'" tabindex="0">'+panel+'</div></div>';
 }).join("");
 return '<figure><p class="figure-help">The charts retain their original labelled scales. On a narrow screen each panel appears separately. Scroll a chart horizontally, or focus it and use the arrow keys, to see its full width. Exact values remain in the tables and CSV downloads below.</p><div class="figure-scroll figure-overview" role="region" aria-label="Four original land-cover panels; scroll horizontally for all panels" tabindex="0">'+svg+'</div><div class="figure-panels">'+panels+'</div><figcaption>'+esc(figure.caption)+'</figcaption></figure>';
}
function reportHTML(sections,figure,svg,sourceLinks){
 const blocks=sections.map(([title,items])=>'<section><h2>'+esc(title)+'</h2>'+items.map(x=>typeof x==="string"?'<p>'+esc(x)+'</p>':x.kind==="table"?renderTable(x,title):x.kind==="figure"?figureHTML(figure,svg):x.kind==="links"?'<ul class="source-links">'+x.items.map(l=>'<li><a href="'+esc(l.path)+'" download>'+esc(l.title)+'</a></li>').join("")+'</ul>':"").join("")+'</section>').join("");
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(TITLE)+'</title><style>*{box-sizing:border-box}body{margin:0;color:#222;background:#eee;font:16px/1.6 Arial,sans-serif}main{max-width:1222px;margin:auto;background:white;padding:36px;min-width:0}h1{font-size:30px;line-height:1.2}h2{margin-top:32px;font-size:21px}h3{font-size:17px}p{max-width:94ch}.kicker{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#555}nav{display:flex;gap:8px 18px;flex-wrap:wrap;border-block:1px solid #bbb;padding:8px 0}nav a{display:inline-flex;align-items:center;min-height:44px;padding:6px 0}a{color:#222}a:focus-visible,.table-scroll:focus-visible,.figure-scroll:focus-visible{outline:2px solid #333;outline-offset:3px}table{border-collapse:collapse;width:100%;font-size:14px;font-variant-numeric:tabular-nums}th,td{text-align:left;border-bottom:1px solid #ccc;padding:8px;vertical-align:top}th{background:#f3f3f3}td{white-space:normal}figure{margin:24px 0;min-width:0}svg{display:block;width:100%;height:auto;overflow:hidden}.figure-scroll,.table-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain}.figure-overview svg{min-width:1100px}.figure-panels{display:none}.panel-scroll svg{min-width:550px}.figure-panel{margin:18px 0}.panel-key,.figure-help,figcaption{font-size:14px;color:#444}.panel-key{margin:0 0 4px}.figure-help{border-left:3px solid #777;padding-left:12px}.source-note{border-left:3px solid #777;padding-left:14px}.source-links a{overflow-wrap:anywhere}@media(max-width:700px){main{padding:18px}h1{font-size:25px}nav{gap:4px 16px}table{min-width:660px}.figure-overview{display:none}.figure-panels{display:block}.figure-panel{margin:24px 0}}@media print{body,main{background:white;margin:0;padding:0;font-size:11px}nav,.figure-help,.figure-overview{display:none}.figure-panels{display:block}.figure-panel{break-inside:avoid;margin:12px 0}.panel-key{font-size:11px}.panel-scroll{overflow:visible}.panel-scroll svg{min-width:0!important;max-width:100%}h2{break-after:avoid}tr{break-inside:avoid}thead{display:table-header-group}table{min-width:0!important;font-size:9px}th,td{padding:4px}.table-scroll{overflow:visible}figure{break-inside:auto}figcaption{font-size:10px}section{margin-bottom:20px}a{color:black;text-decoration:none}@page{size:A4;margin:14mm}}</style></head><body><main><p class="kicker">Upper Savannah • original source interpretation</p><h1>'+esc(TITLE)+'</h1><p class="source-note">Four RFP focus watersheds, two Eighteenmile components and separate Upper Seneca context. Complete original source records, directional changes and exact area support travel with this edition.</p><nav aria-label="Complete report downloads"><a href="observed-report.json" download>Scientific recipe</a><a href="focal-summary.csv" download>Original watershed CSV</a><a href="group-change.csv" download>Original gross/net CSV</a><a href="focal-figures.svg" download>Vector figure</a><a href="scope-summary.csv" download>Geographic-group CSV</a></nav>'+blocks+'<footer><p>Source edition: original-focal-landcover-v2. Full source identities and validation are in reconciliation.json. Figures use original group-change.csv areas; display rounding does not alter retained source quantities.</p></footer></main></body></html>\n';
}
export function composeFocalLandcoverContext({files,parentFiles}={}){
 const originals=retain(files,PINS),parents=retain(parentFiles,PARENT_PINS,"parent/");
 const decode=b=>codec.utf8Decode(b),parse=p=>JSON.parse(decode(originals[p]));
 const selected=parse("selected-annual-inputs.json"),paired=parse("selected-transitions.json"),manifest=parse("model-sources.json");
 eq(selected.schema,"upstate.focal-landcover-source-selection/v1","Focal source schema");
 eq(paired.schema,"upstate.annual-landcover-transitions/v1","Original transition schema");
 const before=JSON.parse(decode(parents["parent/annual-2023.json"])),after=JSON.parse(decode(parents["parent/annual-2025.json"])),full=JSON.parse(decode(parents["parent/transitions-2023-2025.json"]));
 eq(selected.source_sha256.annual_2023,PARENT_PINS["annual-2023.json"].sha256,"Original earlier binding");
 eq(selected.source_sha256.annual_2025,PARENT_PINS["annual-2025.json"].sha256,"Original later binding");
 eq(selected.source_sha256.change_summary,PARENT_PINS["huc12-change-summary.csv"].sha256,"Original changed-row binding");
 const parentChange=decode(parents["parent/huc12-change-summary.csv"]).trimEnd().split("\n");
 eq(selected.changed_rows,parentChange.filter((line,i)=>i===0||IDS.includes(line.split(",")[0])).join("\n")+"\n","Selected original change-summary CSV retained");
 same(selected.grid,before.grid,"Original grid");same(selected.grid,after.grid,"Later original grid");same(selected.method,before.method,"Original source method");
 same(selected.annual_2023.metadata,before.metadata,"Earlier original metadata");same(selected.annual_2025.metadata,after.metadata,"Later original metadata");
 for(const k of Object.keys(full))if(!["watersheds","selection"].includes(k))same(paired[k],full[k],"Original transition "+k);
 same([...paired.selection.huc12].sort(),[...IDS].sort(),"Original focal scope");
 const selections=[{group:"rfp_focus",huc12s:IDS.slice(0,4)},{group:"eighteenmile_huc10",huc10:"0306010106",huc12s:IDS.slice(4,6)},{group:"sv840_current_wbd_huc12",huc12s:IDS.slice(6)}];
 same(selected.selection,selections,"Original three geographic contexts");
 const B=index(before.watersheds,x=>x.huc12,"original earlier"),A=index(after.watersheds,x=>x.huc12,"original later"),M=index(full.watersheds,x=>x.huc12,"original pairs");
 const sb=index(selected.annual_2023.watersheds,x=>x.huc12,"selected earlier"),sa=index(selected.annual_2025.watersheds,x=>x.huc12,"selected later"),sm=index(paired.watersheds,x=>x.huc12,"selected pairs");
 for(const map of [sb,sa,sm]){eq(map.size,IDS.length,"Selected original scope count");for(const id of IDS)requireIt(map.has(id),"Missing selected original "+id);}
 const rows=csvRows(decode(originals["focal-summary.csv"])).map(r=>numeric(r,["huc12","name","context"]));
 const groups=csvRows(decode(originals["group-change.csv"])).map(r=>numeric(r,["huc12","name","group","class_codes"]));
 same(rows.map(r=>r.huc12),IDS,"Original focal CSV ordering");eq(groups.length,28,"Original group row count");
 const G=index(groups,x=>x.huc12+":"+x.group,"group row"),R=index(rows,x=>x.huc12,"focal row");
 const area=selected.method.cell_area_m2/10000;requireIt(area>0&&Number.isFinite(area),"Original positive cell area");
 for(const id of IDS){
  same(sb.get(id),B.get(id),"Byte-derived earlier record "+id);same(sa.get(id),A.get(id),"Byte-derived later record "+id);same(sm.get(id),M.get(id),"Byte-derived original matrix "+id);
  const b=sb.get(id),a=sa.get(id),m=sm.get(id),row=R.get(id);
  eq(row.name,b.properties.name,"Original watershed name");eq(m.paired_valid_cells,b.selected_cells,"Original paired support");eq(a.selected_cells,b.selected_cells,"Original annual support");
  eq(b.nodata_cells,0,"Earlier selected NoData");eq(a.nodata_cells,0,"Later selected NoData");eq(m.valid_before_only_cells+m.valid_after_only_cells+m.both_nodata_cells,0,"Selected unmatched support");
  const matrix=index(m.transitions,t=>t.before_class+":"+t.after_class,"native matrix cell");eq(matrix.size,256,"Complete original16x16matrix");
  let total=0,changed=0;
  for(const i of CODES)for(const j of CODES){const t=matrix.get(i+":"+j);requireIt(t&&Number.isSafeInteger(t.cells)&&t.cells>=0,"Original nonnegative integer cells");total+=t.cells;if(i!==j)changed+=t.cells;close(t.area_ha,t.cells*area,"Original native cell area");}
  eq(total,m.paired_valid_cells,"Original matrix denominator");eq(changed,m.changed_class_cells,"Original matrix changed support");eq(row.selected_cells,total,"Original summary denominator");eq(row.changed_class_cells,changed,"Original summary changed cells");
  close(row.selected_area_ha,total*area,"Original summary area");close(row.changed_class_area_ha,changed*area,"Original changed area");close(row.changed_class_percent,100*changed/total,"Original changed fraction");
  for(const [name,codes] of Object.entries(GROUPS)){
   const g=G.get(id+":"+name);requireIt(g,"Missing original group "+name);eq(g.class_codes,codes.join(";"),"Original group definition");
   const loss=m.transitions.filter(t=>codes.includes(t.before_class)&&!codes.includes(t.after_class)).reduce((s,t)=>s+t.cells,0);
   const gain=m.transitions.filter(t=>!codes.includes(t.before_class)&&codes.includes(t.after_class)).reduce((s,t)=>s+t.cells,0);
   const bc=b.classes.filter(c=>codes.includes(c.class_code)).reduce((s,c)=>s+c.cells,0),ac=a.classes.filter(c=>codes.includes(c.class_code)).reduce((s,c)=>s+c.cells,0);
   for(const [k,v]of Object.entries({before_cells:bc,after_cells:ac,net_cells:ac-bc,gross_loss_cells:loss,gross_gain_cells:gain}))eq(g[k],v,"Original group "+k);
   eq(ac-bc,gain-loss,"Gross versus net identity");for(const [k,v]of Object.entries({before_area_ha:bc*area,after_area_ha:ac*area,net_area_ha:(ac-bc)*area,gross_loss_ha:loss*area,gross_gain_ha:gain*area,before_percent:100*bc/total,after_percent:100*ac/total,change_percentage_points:100*(ac-bc)/total}))close(g[k],v,"Original group "+k);
   close(row[name+"_net_ha"],g.net_area_ha,"Original focal net");if(name==="forest"){close(row.forest_gross_loss_ha,g.gross_loss_ha,"Original focal loss");close(row.forest_gross_gain_ha,g.gross_gain_ha,"Original focal gain");}
  }
  for(const name of ["forest","agriculture"]){const cells=m.transitions.filter(t=>GROUPS[name].includes(t.before_class)&&GROUPS.developed.includes(t.after_class)).reduce((s,t)=>s+t.cells,0);close(row[name+"_to_developed_ha"],cells*area,"Original directional group crossing");}
 }
 const labels=["Four RFP focus watersheds","Eighteenmile HUC10 components","Upper Seneca — separate SV-840 WBD context"];
 const scopes=selections.map((s,i)=>{
  const rr=s.huc12s.map(id=>R.get(id)),sum=k=>rr.reduce((a,r)=>a+r[k],0),cells=sum("selected_cells"),changed=sum("changed_class_cells");
  return{scope:s.group,label:labels[i],huc12s:s.huc12s.join(";"),selected_cells:cells,selected_area_ha:cells*area,changed_class_cells:changed,changed_class_area_ha:changed*area,changed_class_percent:cells?100*changed/cells:null,developed_net_ha:sum("developed_net_ha"),forest_net_ha:sum("forest_net_ha"),forest_gross_loss_ha:sum("forest_gross_loss_ha"),forest_gross_gain_ha:sum("forest_gross_gain_ha"),agriculture_net_ha:sum("agriculture_net_ha"),wetland_net_ha:sum("wetland_net_ha")};
 });
 const output={...originals,...parents};
 const originalInputs=Object.entries(output).map(([p,b])=>descriptor(p,b));
 const reconciliation={schema:"upstate.focal-landcover-report-reconciliation/v1",edition:"original-focal-landcover-v2",source_members:originalInputs,original_source_commit:selected.source_commit,selection:selections,scopes,method:selected.method,grid:selected.grid,checks:{all_original_focal_hashes:true,all_whole_parent_hashes:true,selected_records_equal_full_originals:true,all_original_summary_and_group_values:true,all1792selected_matrix_cells:true,paired_annual_support_exact:true,three_geographic_scopes_preserved:true}};
 output["scope-summary.csv"]=codec.utf8Encode(csv(scopes));output["reconciliation.json"]=codec.utf8Encode(json(reconciliation));
 const figure=figureSpec(groups,rows,originalInputs.filter(x=>["group-change.csv","selected-annual-inputs.json","selected-transitions.json"].includes(x.path)));
 const svg=renderFigure(figure);output["focal-figures.json"]=codec.utf8Encode(json({schema:"upstate.scientific-figure-spec/v1",figures:[figure]}));output["focal-figures.svg"]=codec.utf8Encode(svg);
 const f=scopes[0],e=scopes[1],lt=R.get("030601020507"),low=R.get("030601010704");
 const sections=[
 ["Four priority watersheds",[
  "The four original RFP focus HUC12s retain "+n(f.selected_area_ha)+" hectares of paired-valid source support. "+n(f.changed_class_area_ha)+" hectares change annual classification ("+n(f.changed_class_percent,4)+"%). Their developed-group balance is "+signed(f.developed_net_ha)+" ha; forest balance is "+signed(f.forest_net_ha)+" ha.",
  "Lower Six And Twenty contributes "+n(low.developed_net_ha)+" ha of that developed-group net increase. Its original matrix specifically records "+n(low.forest_to_developed_ha)+" ha moving from forest classes to developed classes and "+n(low.agriculture_to_developed_ha)+" ha from agriculture classes to developed classes. These directional crossings are components of the complete balance, not the net balance itself.",
  table(["Watershed / HUC12","Paired ha","Changed ha","Changed %","Developed net ha","Forest net ha"],rows.slice(0,4).map(r=>[r.name+" / "+r.huc12,n(r.selected_area_ha),n(r.changed_class_area_ha),n(r.changed_class_percent),signed(r.developed_net_ha),signed(r.forest_net_ha)]),[.3,.14,.14,.12,.15,.15])
 ]],
 ["Why gross crossings matter",[
  "Lower Tugaloo retains a forest net balance of "+signed(lt.forest_net_ha)+" ha, alongside "+n(lt.forest_gross_loss_ha)+" ha crossing out of forest and "+n(lt.forest_gross_gain_ha)+" ha crossing into forest. Reporting only net change would hide the larger movement in both directions.",
  "Gross gain and loss cross a group's boundary. Exchanges among deciduous, evergreen and mixed forest stay inside forest and do not count as gross forest crossings. Net balance equals gross gain minus gross loss.",
  {kind:"figure",figure},
  table(["No.","Original watershed","HUC12","Source context"],rows.map((r,i)=>[String(i+1),r.name,r.huc12,r.context]),[.06,.34,.2,.4]),
  table(["Watershed","Forest loss ha","Forest gain ha","Forest net ha","Forest → developed ha","Agriculture → developed ha"],rows.map(r=>[r.name,n(r.forest_gross_loss_ha),n(r.forest_gross_gain_ha),signed(r.forest_net_ha),n(r.forest_to_developed_ha),n(r.agriculture_to_developed_ha)]),[.29,.14,.14,.13,.15,.15])
 ]],
 ["Keep the original geographic scopes",[
  "Upper and Lower Eighteenmile are the two original HUC10 0306010106 components. Together they contain "+n(e.selected_area_ha)+" paired hectares, "+n(e.changed_class_area_ha)+" changed hectares ("+n(e.changed_class_percent,4)+"%), a developed balance of "+signed(e.developed_net_ha)+" ha and a forest balance of "+signed(e.forest_net_ha)+" ha.",
  "These named HUC components are not the USGS-02186702 gauge-contributing polygon. The separate whole-catchment analysis retains its splitCatchment=false footprint, including the local downstream catchment portion. Gauge catchments, monitoring locations and utility source-water areas each retain their own geographic records.",
  "Upper Seneca appears separately because the source author's official WBD point query places SV-840 in HUC12 030601010803. Its lake-study membership is retained. It is excluded from the Eighteenmile subtotal.",
  table(["Original geographic group","HUC12s","Paired ha","Changed ha","Changed %","Developed net ha","Forest net ha"],scopes.map(s=>[s.label,s.huc12s.replaceAll(";"," / "),n(s.selected_area_ha),n(s.changed_class_area_ha),n(s.changed_class_percent,4),signed(s.developed_net_ha),signed(s.forest_net_ha)]),[.23,.23,.11,.11,.1,.11,.11])
 ]],
 ["All original group balances",[
  "Developed = 21–24; forest = 41–43; agriculture = 81–82; wetland = 90 and 95. These groups are mutually exclusive. Developed includes vegetated open-space class 21 and must not be presented as measured impervious area. Woody wetlands remain in the wetland group.",
  table(["HUC12","Group","2023 ha","2025 ha","Gross loss ha","Gross gain ha","Net ha"],groups.map(g=>[g.huc12,g.group,n(g.before_area_ha),n(g.after_area_ha),n(g.gross_loss_ha),n(g.gross_gain_ha),signed(g.net_area_ha)]),[.2,.15,.13,.13,.13,.13,.13])
 ]],
 ["Scientific interpretation and complete sources",[
  "These are descriptions of changes between the original annual product classifications. They do not identify a physical cause, exact event date, classification accuracy or a measured change in nutrient, sediment or microbial outcomes. They provide source context for reviewing model inputs and candidate management areas.",
  "All percentages use original paired-valid support. Native EPSG:5070 cell area is "+String(selected.method.cell_area_m2)+" m² from the affine determinant. The original EPSG:3857 polygon vertices use the retained coordinate operation with stated accuracy "+selected.method.coordinate_conversion.stated_accuracy_m+" m. Centre inclusion, half-open scanline edges and even-odd parity are preserved. The fractional-boundary ledger remains a distinct method.",
  "The seven selected original annual records and complete matrices match their full parent bodies exactly. All original CSV values, 1,792 selected class-pair counts, class/group margins and geographic memberships are verified before this edition is published. Two-decimal display is a reading convention; exact counts and original doubles remain in the complete downloads.",
  "The complete source-author README and both original tables are retained unchanged. Parent annual bodies, complete217 paired matrices, original summary CSV and original parent manifest are included for independent reopening."
 ]]
 ];
 const links=Object.keys(output);sections.at(-1)[1].push({kind:"links",items:links.map(path=>({title:path,path}))});
 output["focal-report.html"]=codec.utf8Encode(reportHTML(sections,figure,svg,links));
 const inputs=Object.entries(output).map(([p,b])=>descriptor(p,b));
 const recipe={schema:"upstate.observed-report/v1",title:TITLE,edition:"original-focal-landcover-v2",vintage:VINTAGE,interpretation_kind:"original_focal_landcover_context",original_source:{domain_sha256:before.metadata.domain_sha256,before:full.metadata.before,after:full.metadata.after,focal_manifest_sha256:PINS["model-sources.json"].sha256,parent_manifest_sha256:PARENT_PINS["model-sources.json"].sha256,selection:selections},inputs,sections:sections.map(([heading,items])=>[heading,items.filter(x=>typeof x==="string"||x.kind!=="figure")]),figure_spec:"focal-figures.json",figures:[{id:figure.id,path:"focal-figures.svg"}],source_links:inputs.map(x=>x.path)};
 const recipeBytes=codec.utf8Encode(json(recipe)),hash=codec.sha256(recipeBytes),sourceId="original-focal-landcover-"+hash.slice(0,20);
 output["observed-report.json"]=recipeBytes;
 const sourceManifest={schema:"upstate.sources/v1",title:TITLE,entries:[{id:sourceId,title:TITLE,kind:"document",role:"OBSERVED_CONTEXT",vintage:VINTAGE,uri:URI,path:"observed-report.json",bytes:recipeBytes.length,sha256:hash,companions:inputs,metadata:{interpretation_kind:recipe.interpretation_kind,product_years:[2023,2025],watershed_count:7,source_context:selections,related_source_ids:manifest.entries.map(x=>x.id),source_relationships:manifest.entries.map(x=>({relationship:"interprets_original_source",source_id:x.id})),parent_paired_source_id:"original-landcover-change-d6dd7d3306c830d710b647ca",spatial_method:selected.method.pixel_rule}}]};
 output["source-manifest.json"]=codec.utf8Encode(json(sourceManifest));
 return{sourceId,recipe,manifest:sourceManifest,files:output,summary:{scopes,watersheds:7,group_rows:28,panels:4,figure_points:84,source_members:inputs.length},reconciliation};
}
