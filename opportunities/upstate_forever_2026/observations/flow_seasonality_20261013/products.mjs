/** Native observed-report sections and reproducible tabular companions. */
import {SEASONS,csv,compactFlowSeasonality} from "./flow_seasonality.mjs";
export const PREFIX="observations/flow_seasonality_20261013";
const json=value=>JSON.stringify(value,null,2)+"\n",compact=value=>JSON.stringify(value)+"\n";
const show=(value,d=2)=>value==null?"—":Number(value).toFixed(d);
const pct=(value,d=2)=>value==null?"—":show(value*100,d)+"%";
const years=value=>value.length?value.join(", "):"none";
const monthNames=["January","February","March","April","May","June","July","August","September","October","November","December"];
const mdTable=(columns,rows)=>"| "+columns.join(" | ")+" |\n| "+columns.map(()=>"---").join(" | ")+" |\n"+rows.map(r=>"| "+r.map(v=>String(v).replaceAll("|","\\|").replaceAll("\n"," ")).join(" | ")+" |").join("\n");
function contents(result){
 const s=result.summary,bySite=new Map(result.stations.map(row=>[row.site,row]));
 const comparisons=result.seasonalComparisons.filter(row=>row.year===2023&&row.reference_basis==="complete_numeric");
 const e=comparisons.filter(row=>row.site==="02186702");
 const summer=e.find(row=>row.season==="summer"),autumn=e.find(row=>row.season==="autumn");
 const coverRows=result.stations.map(row=>[row.site+" · "+row.site_name,row.complete_year_count+" / "+row.fully_approved_year_count,result.monthly.filter(x=>x.site===row.site&&x.complete_numeric).length+" / 72",result.seasonal.filter(x=>x.site===row.site&&x.complete_numeric).length+" / 24",years(row.complete_years)]);
 const seasonalRows=result.stations.map(row=>[row.site+" · "+row.site_name,...SEASONS.map(season=>{
  const x=comparisons.find(x=>x.site===row.site&&x.season===season.id);
  return x.target_eligible&&x.target_to_reference_mean_ratio!==null?show(x.target_to_reference_mean_ratio,3)+" × ["+x.reference_year_count+"]":x.target_eligible?"no complete reference":x.target_numeric_days+"/"+x.target_expected_days+" days";
 })]);
 const eRows=e.map(row=>[row.season==="winter"?"Winter: Jan + Feb + Dec":row.season[0].toUpperCase()+row.season.slice(1),row.target_numeric_days+"/"+row.target_expected_days,show(row.target_observed_mean_cfs,3),show(row.reference_median_period_mean_cfs,3),show(row.target_to_reference_mean_ratio,3)+" ×",show(row.target_observed_volume_m3/1e6,3),years(row.reference_years)]);
 const distributionRows=result.stations.map(row=>[row.site+" · "+row.site_name,years(row.complete_years),row.peak_mean_fraction_month===null?"—":monthNames[row.peak_mean_fraction_month-1],pct(row.peak_mean_fraction),pct(row.median_complete_year_p95_volume_fraction),show(row.median_complete_year_q5_q95_ratio,2)]);
 const periodOnlySeasons=result.seasonal.filter(row=>row.complete_numeric&&!row.annual_complete_numeric).length;
 const periodOnlyMonths=result.monthly.filter(row=>row.complete_numeric&&!row.annual_complete_numeric).length;
 const overview="The retained record contains "+s.daily_source_records.toLocaleString("en-US")+" original daily records for "+s.gauge_count+" gauges in 2020–2025, including "+s.numeric_daily_records.toLocaleString("en-US")+" numeric daily means and one original nonnumeric Rat/P record. Of "+s.calendar_year_periods+" gauge-years, "+s.complete_numeric_years+" have every calendar day numeric and "+s.fully_approved_complete_years+" also have an approved flag on every day. There are "+s.complete_numeric_months+" complete months and "+s.complete_numeric_seasons+" complete seasons.";
 const independence="Calendar-period comparisons preserve "+periodOnlyMonths+" complete months and "+periodOnlySeasons+" complete seasons within years that lack a complete annual record. A complete season is usable for its own mean and volume comparison. Annual-volume fractions require the complete annual denominator. All missing numeric dates, nonnumeric originals and source flags remain available in the companion tables.";
 const contrast="At Eighteenmile Creek below Pendleton, the 2023 summer mean was "+show(summer.target_observed_mean_cfs,3)+" cfs, "+show((summer.target_to_reference_mean_ratio-1)*100,2)+"% above the median of its other complete summers. Autumn averaged "+show(autumn.target_observed_mean_cfs,3)+" cfs, "+show((1-autumn.target_to_reference_mean_ratio)*100,2)+"% below the corresponding autumn median. Summer carried "+pct(summer.target_annual_volume_fraction)+" of complete 2023 volume compared with a "+pct(summer.reference_median_annual_volume_fraction)+" median share; autumn carried "+pct(autumn.target_annual_volume_fraction)+" compared with "+pct(autumn.reference_median_annual_volume_fraction)+". These temporal contrasts identify different hydrologic sampling contexts within the same annual period.";
 const basis="Each selected year is compared with other complete periods at the same gauge. The complete_numeric basis admits numeric values with their retained original flags. The fully_approved_complete basis requires A on every target and reference-period day; A:e remains both approved and estimated. Period-level reference years and annual-fraction reference years are recorded separately. For Eighteenmile 2023, approved summer and autumn comparisons include 2025, while approved annual-fraction references exclude 2025 because its winter contains provisional values.";
 const durationText="Daily flow-duration values use the R-7 observed quantile at 1 minus exceedance probability: Q5 is the high-flow P95 and Q95 is the low-flow P05. The table below reports the median across each gauge's complete years of the share of annual volume carried by days at or above that year's P95. The inclusive threshold retains ties. At Stevens Creek (02196000), this median share is "+pct(bySite.get("02196000").median_complete_year_p95_volume_fraction)+" across six complete years; at Kettle Creek (02193340), "+pct(bySite.get("02193340").median_complete_year_p95_volume_fraction)+" across six. Eighteenmile's six-year median is "+pct(bySite.get("02186702").median_complete_year_p95_volume_fraction)+". Augusta Canal's "+pct(bySite.get("02196485").median_complete_year_p95_volume_fraction)+" uses only 2020 and 2025. These are observed within-gauge distributions with different record support.";
 const cautions="The record is six dated years, with fewer complete years at some gauges. Reference minima, medians and maxima describe those actual years and are not confidence intervals or long-term climatological normals. Gauge volumes retain their individual contributing areas and are not summed across nested stations. Streamflow context does not supply constituent concentrations or annual nitrogen, phosphorus or sediment export. Catchment boundaries, outlet/network position, source-period coverage and any documented transfers or regulation still need to match the intended scientific comparison.";
 const links=[
  ["Calendar-month observed volumes and original coverage",PREFIX+"/monthly.csv"],
  ["Calendar-season observed volumes and original coverage",PREFIX+"/seasonal.csv"],
  ["All selected-year monthly comparisons and exact reference years",PREFIX+"/monthly-comparisons.csv"],
  ["All selected-year seasonal comparisons and exact reference years",PREFIX+"/seasonal-comparisons.csv"],
  ["Complete-year annual fractions by calendar month",PREFIX+"/monthly-profiles.csv"],
  ["Complete-year annual fractions by calendar season",PREFIX+"/seasonal-profiles.csv"],
  ["Every gauge-year flow-duration curve",PREFIX+"/flow-duration.csv"],
  ["Dated high/low-flow originals and source response positions",PREFIX+"/original-flow-positions.json"],
  ["Original response identities, URLs and calculation inputs",PREFIX+"/inputs.json"],
  ["Full calculation and scientific interpretation guide",PREFIX+"/README.md"]
 ];
 const sections=[
  ["Calendar-period hydrology and calibration support",[overview,independence,{kind:"table",columns:["Gauge","Complete / approved years","Complete months","Complete seasons","Complete calendar years"],rows:coverRows,widths:[3,1,1,1,2],caption:"Independent numeric completeness for all 2020–2025 calendar periods. Approved is an additional source flag criterion, not a replacement for the estimated flag."}]],
  ["Seasonal flow contrasts in the 2023 observation period",[contrast,{kind:"table",columns:["Eighteenmile season","Days","Mean (cfs)","Reference median (cfs)","Mean ratio","Volume (million m³)","Other complete years"],rows:eRows,widths:[2,1,1,1,1,1,2],caption:"Winter combines January, February and December of the stated calendar year. Ratios use complete seasons independently of annual completeness."},basis,{kind:"table",columns:["Gauge","Winter Jan+Feb+Dec","Spring Mar–May","Summer Jun–Aug","Autumn Sep–Nov"],rows:seasonalRows,widths:[3,1,1,1,1],caption:"2023 mean discharge divided by the median of other complete periods. Brackets give reference-year counts. Partial targets retain numeric/expected days and no ratio; exact years and source flags remain in the CSV."}]],
  ["Annual flow allocation and observed flow-duration context",[durationText,{kind:"table",columns:["Gauge","Complete years","Largest mean monthly share","Annual share","P95-day volume share","Q5 / Q95"],rows:distributionRows,widths:[3,2,1,1,1,1],caption:"Monthly shares average fractions equally across complete years. Tail-volume share and Q5/Q95 are medians of complete-year values. The one-year Waynesboro result has one year's support."},cautions]],
  ["Reproducible periods, units and original source records",[
   "Daily decimal discharge values are added with exact scaled integers before conversion using 0.028316846592 m³ per cubic foot and 86,400 nominal seconds per day. Unknown days contribute no invented flow. Complete-period volume is absent when any selected calendar day lacks a numeric value; observed-period volume remains the sum of retained known days.",
   "Mean ratios compare daily mean discharge, while volume ratios retain actual period duration. Leap-year February and the calendar-year winter can have an extra day. Annual fractions remain on a complete calendar-year denominator. Fully approved references are separate explicit selections, and estimated or revised flags remain visible within them.",
   "The frozen input is the exact flow-data JSON extracted from the retained 29-gauge source edition. All 77 original response/inventory files retain exact SHA-256 identities; 56 supplied the daily flow records. Original source ID, JSON value-series/record position or RDB line number accompanies every retained high/low-flow date. The Horse Creek 2024-09-24 Rat/P source row remains nonnumeric.",
   {kind:"links",items:links.map(([title,path])=>({title,path}))}
  ]]
 ];
 const guide="# 29-gauge calendar seasonality and flow-duration context\n\n"+
 "## Findings and coverage\n\n"+overview+"\n\n"+independence+"\n\n"+mdTable(["Gauge","Complete / approved years","Complete months","Complete seasons","Complete years"],coverRows)+"\n\n"+
 "## Eighteenmile 2023 seasonal interpretation\n\n"+contrast+"\n\n"+mdTable(["Season","Numeric / expected days","Mean cfs","Reference median cfs","Mean ratio","Observed million m³","Reference years"],eRows)+"\n\n"+basis+"\n\n"+
 "A near-reference annual mean can conceal opposing seasonal changes. Use the actual month or season surrounding an observation when judging its hydrologic context, then retain the annual period separately for annual-model comparisons. These calculations describe observed discharge without assigning the seasonal contrast to a particular land-use or weather cause.\n\n"+
 "## All 29 gauges: 2023 comparison\n\n"+mdTable(["Gauge","Winter ratio [N]","Spring ratio [N]","Summer ratio [N]","Autumn ratio [N]"],seasonalRows)+"\n\n"+
 "Each ratio uses the selected season's mean daily discharge divided by the median mean of other complete seasons at that station. A value of 1 equals that reference median. Brackets give the actual reference-year count, which can differ by season. Day-count cells have incomplete target seasons. The companion seasonal-comparisons.csv contains every selected year from 2020 through 2025 and both explicit quality bases.\n\n"+
 "## Flow concentration and annual allocation\n\n"+durationText+"\n\n"+mdTable(["Gauge","Complete years","Peak mean share month","Mean annual share","Median P95-day volume share","Median Q5/Q95"],distributionRows)+"\n\n"+cautions+"\n\n"+
 "For calibration-period selection, inspect the complete-period counts first, compare the intended target's mean/volume against its retained reference years, then inspect flow-duration curves and dated high-flow contributions. Stations with one or two complete years provide a narrow empirical comparison. Discharge at different network positions retains its own support; a shared date or station label does not establish catchment equivalence.\n\n"+
 "## Calculation contract\n\n"+Object.entries(s.methods).map(([key,value])=>"**"+key+"** — "+value).join("\n\n")+"\n\n"+
 "Both comparison bases govern target and reference eligibility. Actual observed means/volumes remain visible even for an ineligible target, but a comparison ratio is null. Annual-volume fraction eligibility is checked separately. Monthly/seasonal reference flags join exactly from the corresponding period table by site, reference year and month/season; they are not duplicated as large nested objects in every comparison row.\n\n"+
 "Winter is explicitly January + February + December of one calendar year. It partitions that year's volume rather than defining a contiguous December-to-February event season or water year. Complete-year monthly fractions are averaged with equal weight per year; months retain their actual duration, including leap-year February.\n\n"+
 "## Files and source binding\n\n"+links.map(([title,path])=>"- ["+title+"](../../"+path+")").join("\n")+"\n\n"+
 "annual.csv records 174 gauge-years, monthly.csv 2,088 calendar months, seasonal.csv 696 seasons, flow-duration.csv 3,654 exceedance points, monthly-comparisons.csv 4,176 comparison selections and seasonal-comparisons.csv 1,392 selections. Monthly/seasonal profile tables describe annual-volume fractions using complete annual denominators. station-context.csv summarizes all 29 gauges. explorer-data.json carries the same consumer data in columnar form: each table has columns and rows, and null retains missing values.\n\n"+
 "inputs.json records the immutable original HTML edition and exact extracted original-flow-data.json bytes. The evolving explorer HTML is not an input dependency, so adding this analysis to it does not create a source cycle. The 77 original response/inventory files remain at their ordinary application paths and are bound by path, size, SHA-256 and original URL. Agency spelling, qualifiers and response positions remain unchanged.\n\n"+
 "## Rebuild and native report use\n\nFrom the application root:\n\n"+
 "~~~sh\nnode observations/flow_seasonality_20261013/rebuild.mjs --app-root .\n~~~\n\n"+
 "The rebuild verifies the frozen flow input and every original response/inventory body, reproduces the tables and report sections, and writes the native root manifest. It reconciles every annual count, source-flag count, mean and volume with the retained original annual aggregates before producing outputs. No network request is needed.\n\n"+
 "Import observed_flow_seasonality.sources.json in the existing Sources workflow. Its report_schema is upstate.observed-report/v1, so the ordered observed-report picker can compose it alongside the original lake, stream and calibration reports. Tabular outputs and original inputs remain ordinary report companions. This dated hydrologic context does not enter nutrient/sediment fitting as an annual mass observation.\n\n"+
 "The maintained standalone renderer selects both reports by repeating --manifest:\n\n"+
 "~~~sh\npython source/observed-report-20261013/render.py --app-root . --workspace /absolute/workspace --manifest observed_hydrology_context.sources.json --manifest observed_flow_seasonality.sources.json --output /absolute/output/observed-seasonality\n~~~\n\n"+
 "The existing native source-only receiver can import the manifest independently of GIS execution. Gauge/catchment geometry stays with the maintained Station Geography and basin-source families.\n";
 return {sections,guide};
}
export function flowSeasonalityProducts(result,inputs,staticFiles,describe){
 const files={},put=(name,body)=>files[PREFIX+"/"+name]=body;
 const mappings={annual:"annual.csv",monthly:"monthly.csv",seasonal:"seasonal.csv",duration:"flow-duration.csv",monthlyProfile:"monthly-profiles.csv",seasonalProfile:"seasonal-profiles.csv",stations:"station-context.csv",monthlyComparisons:"monthly-comparisons.csv",seasonalComparisons:"seasonal-comparisons.csv"};
 for(const [key,name]of Object.entries(mappings))put(name,csv(result[key]));
 put("summary.json",json({...result.summary,complete_seasons_with_incomplete_year:result.seasonal.filter(r=>r.complete_numeric&&!r.annual_complete_numeric).length,complete_months_with_incomplete_year:result.monthly.filter(r=>r.complete_numeric&&!r.annual_complete_numeric).length}));
 put("original-flow-positions.json",compact({schema:"upstate.observed-flow-positions/v1",sources:inputs.source_members,periods:result.positions}));
 put("explorer-data.json",compact(compactFlowSeasonality(result)));
 const {sections,guide}=contents(result);put("README.md",guide);
 const retained={...staticFiles,...files},members=Object.entries(retained).map(([path,body])=>describe(path,body));
 for(const source of inputs.source_members)members.push({path:source.path,bytes:source.bytes,sha256:source.sha256});
 const seen=new Set();for(const member of members){if(seen.has(member.path))throw Error("Duplicate original report member "+member.path);seen.add(member.path);}
 members.sort((a,b)=>a.path.localeCompare(b.path));
 const recipe={schema:"upstate.observed-report/v1",title:"Observed flow seasonality and calibration-period context: 29 gauges, 2020–2025",edition:"observed-flow-seasonality-20261013-v1",period:inputs.period,inputs:members,sections,source_links:[PREFIX+"/inputs.json",PREFIX+"/original-flow-data.json",...inputs.source_members.map(r=>r.path)]};
 const recipePath="observed_flow_seasonality.report.json";files[recipePath]=json(recipe);
 files["observed_flow_seasonality.sources.json"]=json({schema:"upstate.sources/v1",title:recipe.title,captured_at:"2026-10-13",entries:[{
  id:"observed-flow-seasonality-29-gauges-20261013",title:recipe.title,kind:"document",...describe(recipePath,files[recipePath]),
  uri:"https://api.waterdata.usgs.gov/",vintage:"2020–2025 original daily mean discharge; source recovery and derived calendar context 2026-10-13",
  metadata:{report_schema:"upstate.observed-report/v1",context_layer:true,observation_kind:"hydrologic_context",gauge_count:29,original_daily_records:result.summary.daily_source_records,numeric_daily_records:result.summary.numeric_daily_records,complete_numeric_years:result.summary.complete_numeric_years,complete_numeric_months:result.summary.complete_numeric_months,complete_numeric_seasons:result.summary.complete_numeric_seasons,source_urls:inputs.source_members.map(r=>r.url)},
  companions:members
 }]});
 return files;
}
