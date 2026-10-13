import {buildExplorer} from "../../nc_ambient_measurements/20261013/create_report_explorer.mjs";
import {BASE} from "./derive.mjs";
/** Add the source's explicit blank/replicate control to the maintained measurement viewer. */
export function renderExplorer(built){
 let html=buildExplorer(JSON.parse(built.files[BASE+"observations.json"]),{
  title:"Big Creek: original samples, blanks and laboratory sensitivity",
  sourcePrefix:BASE,sources:built.sourceInventory,sourceEdition:"NCDEQ original 2011–2012 selected-analyte records · captured 13 October 2026",
  reportHref:"report.html"
 });
 const replace=(from,to)=>{const first=html.indexOf(from);if(first<0||html.indexOf(from,first+from.length)!==-1)throw Error("The maintained explorer source changed at the activity-control seam: "+from);html=html.slice(0,first)+to+html.slice(first+from.length);};
 replace('<label>From date','<label>Original activity type<select name="activity_type"><option value="">All activity types</option></select></label><label>From date');
 replace("(!f.status||r.status===f.status)&&","(!f.status||r.status===f.status)&&(!f.activity_type||r.activity_type===f.activity_type)&&");
 replace("qualifier:'qualifier',status:'status'","qualifier:'qualifier',status:'status',activity_type:'activity_type'");
 replace("'qualifier','status','query','sort'","'qualifier','status','activity_type','query','sort'");
 replace("param=form.elements.parameter.value;","param=form.elements.parameter.value,activity=form.elements.activity_type.value;");
 replace("(!param||g.fields.characteristic===param));","(!param||g.fields.characteristic===param)&&(!activity||g.fields.activity_type===activity));");
 replace("['station','parameter'].includes","['station','parameter','activity_type'].includes");
 replace("f.media,f.media_subdivision||'media subdivision absent'","f.activity_type,f.media,f.media_subdivision||'media subdivision absent'");
 replace("['fraction','Fraction',false]","['activity_type','Activity type',true],['fraction','Fraction',true]");
 replace("row.fraction,row.media,row.qualifier","row.fraction,row.activity_type,row.media,row.qualifier");
 replace("<main>","<main><section><h2>Keep environmental samples and quality control separate</h2><p>All 943 source records remain here: 564 routine environmental samples, 336 equipment blanks, 24 field blanks and 19 field replicates. Choose the original activity type before comparing environmental support. Original sample fractions and 36 exact groups remain separate. The 915 nondetects retain their real limits; one turbidity record was not reported under the publisher’s Z2 reliability flag.</p><p>All analytical-method identifier fields are blank in this source edition. The report explains historical reference values and current laboratory planning considerations.</p></section>");
 html=html.replaceAll("nc-ambient-selected-observations.csv","nc-big-creek-selected-observations.csv").replaceAll("nc-ambient-observation-selection.json","nc-big-creek-observation-selection.json");
 return html;
}
