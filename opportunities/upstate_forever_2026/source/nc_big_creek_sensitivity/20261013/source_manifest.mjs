import {BASE} from "./derive.mjs";
export function sourceManifest(files,descriptor){
 const reportPath=BASE+"observed-report.json",report=JSON.parse(files[reportPath]),summary=JSON.parse(files[BASE+"summary.json"]);
 return{schema:"upstate.sources/v1",title:report.title,captured_at:"2026-10-13",
  scope:{station_id:summary.station_id,original_results:summary.original_result_rows,selected_characteristics:summary.original_characteristics,collection_dates:[summary.first_date,summary.last_date],edition:report.edition},
  entries:[{id:"nc-big-creek-sensitivity-observed-report",title:report.title,kind:"document",role:"OBSERVED_CONTEXT",...descriptor(reportPath,files[reportPath]),source_format:"JSON",uri:"urn:upstate:nc-big-creek-sensitivity:20261013",vintage:"Original NCDEQ 2011–2012 selected-analyte WQX3 records; captured 13 October 2026",
   metadata:{report_schema:"upstate.observed-report/v1",measurement_schema:summary.schema,edition:report.edition,result_rows:summary.original_result_rows,source_semantics:"Observed original samples with separate blank/replicate roles, fractions and reporting limits",source_station_crs:"EPSG:4269"},
   companions:Object.keys(files).filter(p=>p.startsWith(BASE)&&p!==reportPath).sort().map(path=>descriptor(path,files[path]))}]};
}
