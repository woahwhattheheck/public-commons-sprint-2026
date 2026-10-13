// Present original national station support beside the retained regional annual targets.
import { createArchiveCodec } from "./archive_codec.mjs";
import { enrichAnnualReferences, annualStationContextCsv, annualStationContextMarkdown } from "./annual_reference_enrichment_core.mjs";
const codec=createArchiveCodec();
const json=value=>JSON.stringify(value,null,2)+"\n";
const body=value=>typeof value==="string"?codec.utf8Encode(value):value;
const identify=value=>({bytes:body(value).length,sha256:codec.sha256(body(value))});
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const number=value=>typeof value==="number"&&Number.isFinite(value)?value.toLocaleString("en-US",{maximumFractionDigits:6}):"Not reported";
const unit=value=>value==="metric_tonnes/year"?"tonnes/year":value;
const species={"00600":"Total nitrogen","00665":"Total phosphorus","00530":"Total suspended solids (TSS)","80154":"Suspended sediment (SSC)"};
const relative=value=>{
  if(typeof value!=="string"||!value||value.includes("\\")||value.startsWith("/")||value.split("/").some(x=>!x||x==="."||x===".."))
    throw Error("Annual national source requires a safe original relative path");
  return value;
};
export const NATIONAL_ORIGINAL_DIRECTORY="source/usgs-national-annual-2012";

export function prepareAnnualStationReport({regional,inventoryText,originalFiles}) {
  if(typeof inventoryText!=="string"||!originalFiles||typeof originalFiles!=="object")
    throw Error("Retain both the complete original national inventory and its source files");
  const regionalText=json(regional);
  const context=enrichAnnualReferences(regionalText,inventoryText,identify);
  const inventory=JSON.parse(inventoryText), originals={}, descriptors=[];
  const retain=(name,expected)=>{
    relative(name);
    const value=originalFiles[name];
    if(value===undefined)throw Error("Missing original national source: "+name);
    const actual=identify(value);
    if(actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)
      throw Error("Original national source differs from its inventory: "+name);
    const path=NATIONAL_ORIGINAL_DIRECTORY+"/"+name;
    if(originals[path]!==undefined&&identify(originals[path]).sha256!==actual.sha256)
      throw Error("National original source paths collide");
    originals[path]=value; descriptors.push({path,...actual});
  };
  for(const [name,entry] of Object.entries(inventory.source.files)) {
    retain(name,entry);
    if(entry.http_receipt)retain(entry.http_receipt.path,entry.http_receipt);
  }
  const files={
    "inputs/original-national-annual-inventory.json":inventoryText,
    "inputs/original-regional-reference-yields.json":regionalText,
    "annual-reference-station-context.json":json(context),
    "annual-reference-station-context.csv":annualStationContextCsv(context),
    "annual-reference-station-context.md":annualStationContextMarkdown(context),
  };
  const binding={schema:"upstate.annual-reference-station-report/v1",
    context:identify(files["annual-reference-station-context.json"]),
    regional:context.original_regional_input,inventory:context.original_national_inventory,
    original_files:descriptors,summary:context.summary};
  files["annual-reference-station-report.json"]=json(binding);
  return {context,binding,files,originalFiles:originals};
}

function station(row) {
  const r=row.regional_reference;
  return r.station_name+" ("+r.station_id+")\nCOMID "+r.comid;
}
function status(row) {
  return row.match_status==="not_found"?"No exact national record":
    row.match_status==="ambiguous"?"Multiple original national records":
    row.match_status==="matched_with_source_issues"?"Original national source issue":
    "Exact original station, constituent and COMID";
}
function mass(value,units) {return typeof value==="number"?number(value)+" "+unit(units):"Not reported";}
function period(value) {
  if(!value)return"Not reported";
  return String(value.start??value.start_inclusive??"Not reported")+" to "+
    String(value.end??value.end_inclusive??"Not reported");
}
function method(row) {return row.national_estimate?.method||status(row);}
function groups(context) {
  return Object.entries(species).map(([code,title])=>({code,title,rows:context.rows.filter(r=>r.match_key.parameter_code===code)})).filter(g=>g.rows.length);
}
const table=(columns,rows,widths)=>({kind:"table",columns,rows:rows.map(r=>r.map(String)),widths});

export function annualStationScientificSections(report) {
  const {context}=report;
  const blocks=[
    "The regional annual-reference values remain the original published targets. The national release is joined by exact station identifier, constituent code and COMID. It supplies its own original estimator, sampling/flow periods and published standard error; an absent or ambiguous match remains visible.",
    context.uncertainty_interpretation,
    "Both estimates below are annual rates. Sediment kg/year is converted to metric tonnes/year once. The reported national standard error stays attached to that national estimate; it is not applied to the regional target or to modeled restoration effects. TSS and SSC retain their separate measured bases.",
  ];
  for(const group of groups(context)) {
    blocks.push(group.title);
    blocks.push(table(["Original station / reach","Regional reference","National estimate","National standard error"],
      group.rows.map(row=>{
        const n=row.national_estimate,r=row.regional_reference;
        return [station(row),mass(r.annual_reference_mass,r.annual_mass_unit),
          n?mass(n.annual_mass_in_regional_unit,r.annual_mass_unit):status(row),
          n?mass(n.standard_error.in_regional_unit,r.annual_mass_unit):"Not available"];
      }),[0.34,0.22,0.22,0.22]));
    blocks.push(table(["Original station / method","Water-quality observations","Flow prediction support"],
      group.rows.map(row=>{
        const n=row.national_estimate;
        return [station(row)+"\n"+method(row),n?period(n.water_quality_period)+
          "\nObservations: "+String(n.original_water_quality_observations??"Not reported")+
          "; censored: "+String(n.original_censored_observations??"Not reported"):"Not available",
          n?period(n.original_flow_period)+" (inclusive)\nFlow station: "+String(n.original_flow_station_id??"Not reported"):"Not available"];
      }),[0.38,0.32,0.30]));
  }
  blocks.push(context.source_period_interpretation,
    "The complete JSON and CSV retain national-minus-regional differences, original merged-station descriptions and published gage drainage areas. The original whole-polygon reference area remains the yield denominator. Nested basin loads and their errors are not summed; the ten retained basin relationships still apply.",
    {kind:"links",items:[
      {title:"National station context with complete source rows",path:"association/annual-reference-station-context.json"},
      {title:"Station periods, methods and original numeric estimates (CSV)",path:"association/annual-reference-station-context.csv"},
      {title:"Original national archive inventory",path:"association/inputs/original-national-annual-inventory.json"},
      {title:"Original national load tables",path:"association/"+NATIONAL_ORIGINAL_DIRECTORY+"/load_est.zip"},
      {title:"Original paired station tables",path:"association/"+NATIONAL_ORIGINAL_DIRECTORY+"/sitegage.zip"},
      {title:"Original USGS source dictionary",path:"association/"+NATIONAL_ORIGINAL_DIRECTORY+"/F7DN436B-original-metadata.xml"},
    ]});
  return [["Original annual station periods and estimator uncertainty",blocks]];
}

export function addAnnualStationContextHtml(html,report) {
  if(typeof html!=="string"||html.split("</main>").length!==2)
    throw Error("Retain the existing complete association report before adding national source context");
  const {context}=report;
  const links=[
    ["annual-reference-station-context.csv","Complete station CSV"],
    ["annual-reference-station-context.json","Original records and methods"],
    ["annual-reference-station-context.md","Method note"],
    ["inputs/original-national-annual-inventory.json","Original national inventory"],
    [NATIONAL_ORIGINAL_DIRECTORY+"/load_est.zip","Original load archive"],
    [NATIONAL_ORIGINAL_DIRECTORY+"/sitegage.zip","Original station archive"],
  ];
  let content='<section id="annual-national-station-support" class="annual-national"><h2>Original station periods and annual-load uncertainty</h2>'+
    '<p>The regional values below remain the original annual targets. The national release supplies a separate estimator and its own published standard error, joined by exact station, constituent and COMID.</p>'+
    '<p>'+esc(context.uncertainty_interpretation)+'</p>';
  for(const group of groups(context)) {
    content+='<h3>'+esc(group.title)+'</h3><p class="annual-national-scroll">On a narrow screen, scroll the table horizontally. All values and source records remain in the downloads.</p>'+
      '<div class="annual-national-table" role="region" tabindex="0" aria-label="'+esc(group.title+' national station context')+'"><table><thead><tr>'+
      ["Original station / reach","Regional annual reference","National annual estimate","National standard error","Original sampling and flow support","Estimator / source distinction"].map(x=>"<th scope=\"col\">"+esc(x)+"</th>").join("")+
      "</tr></thead><tbody>";
    for(const row of group.rows) {
      const n=row.national_estimate,r=row.regional_reference;
      const support=n?"Water quality: "+period(n.water_quality_period)+"\nObservations: "+String(n.original_water_quality_observations??"Not reported")+
        "; censored: "+String(n.original_censored_observations??"Not reported")+"\nFlow: "+period(n.original_flow_period)+" (inclusive)\nFlow station: "+
        String(n.original_flow_station_id??"Not reported"):status(row);
      const detail=method(row)+(n?"\nNational minus regional: "+mass(row.comparison.national_minus_regional_in_regional_unit,r.annual_mass_unit):"")+
        (row.source_issues?"\n"+row.source_issues.join("; "):"");
      const cells=[station(row),mass(r.annual_reference_mass,r.annual_mass_unit),
        n?mass(n.annual_mass_in_regional_unit,r.annual_mass_unit):status(row),
        n?mass(n.standard_error.in_regional_unit,r.annual_mass_unit):"Not available",support,detail];
      content+="<tr>"+cells.map(v=>"<td>"+esc(v).replaceAll("\n","<br>")+"</td>").join("")+"</tr>";
    }
    content+="</tbody></table></div>";
  }
  content+='<p>'+esc(context.source_period_interpretation)+'</p><p>National standard errors are not combined across nested basins. Published gage areas remain separate from the full polygon areas used by the existing yield table. TSS is not converted into SSC.</p>'+
    '<p>'+links.map(([path,label])=>'<a href="'+esc(path)+'" download>'+esc(label)+'</a>').join(" · ")+'</p>'+
    '<p>Original sources: <a href="https://doi.org/10.5066/F7DN436B">USGS F7DN436B</a>; <a href="https://doi.org/10.3133/sir20195069">Saad and others, 2019</a>.</p></section>';
  const style='<style>.annual-national{color:#202020;background:#fff;margin:2rem 0}.annual-national-table{max-width:100%;overflow:auto;overscroll-behavior-inline:contain;border:1px solid #aaa;margin-bottom:1.5rem}.annual-national-table:focus{outline:2px solid #333;outline-offset:2px}.annual-national-table table{border-collapse:collapse;width:100%;font-size:.9rem}.annual-national-table th,.annual-national-table td{min-width:9rem;padding:.6rem;text-align:left;vertical-align:top;white-space:normal;overflow-wrap:normal;word-break:normal;color:#202020;background:#fff;border-bottom:1px solid #bbb}.annual-national-table th{background:#ededed}.annual-national-scroll{font-size:.9rem;color:#444}@media print{.annual-national-table{overflow:visible}.annual-national-table th,.annual-national-table td{min-width:0;padding:.25rem;font-size:8pt}.annual-national-scroll{display:none}}</style>';
  return html.replace("</main>",style+content+"</main>");
}
