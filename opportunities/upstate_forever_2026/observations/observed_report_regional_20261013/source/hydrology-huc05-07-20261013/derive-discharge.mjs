#!/usr/bin/env node
/** Reproduce the retained USGS daily source join with Node's standard library. */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,dirname,relative} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";

function parseDaily(body, year, sourcePath) {
  let header=null, expectedTypes=false, block=0;
  const records=[];
  const lines=body.split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(!line || line.startsWith("#")) continue;
    const values=line.split("\t");
    if(values[0]==="agency_cd"){
      header=values; expectedTypes=true; block++; continue;
    }
    if(!header) throw new Error("Data before header at line "+(i+1));
    if(expectedTypes){
      if(values.length!==header.length || values.some(x=>!/^\d+[a-z]$/i.test(x))) throw new Error("Invalid RDB types at line "+(i+1));
      expectedTypes=false; continue;
    }
    if(values.length!==header.length) throw new Error("RDB width mismatch at line "+(i+1));
    const row=Object.fromEntries(header.map((key,j)=>[key,values[j]]));
    if(row.agency_cd!=="USGS" || !/^\d+$/.test(row.site_no) || !/^\d{4}-\d{2}-\d{2}$/.test(row.datetime)) throw new Error("Invalid source identity at line "+(i+1));
    if(!row.datetime.startsWith(String(year)+"-") || new Date(row.datetime+"T00:00:00Z").toISOString().slice(0,10)!==row.datetime) throw new Error("Date outside selected year at line "+(i+1));
    let found=0;
    for(const key of header){
      const match=/^(\d+)_00060_00003$/.exec(key);
      if(!match) continue;
      found++;
      const value=row[key];
      if(!Object.prototype.hasOwnProperty.call(row,key+"_cd")) throw new Error("Missing original qualifiers at line "+(i+1));
      const numeric=value.trim()!=="" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) && Number.isFinite(Number(value));
      records.push({agency_cd:row.agency_cd,site_no:row.site_no,date:row.datetime,ts_id:match[1],parameter_cd:"00060",statistic_cd:"00003",reported_value:value,qualifiers:row[key+"_cd"],value_cfs:numeric?Number(value):null,source_path:sourcePath,source_line:i+1,source_block:block});
    }
    if(!found) throw new Error("No daily-mean discharge column at line "+(i+1));
  }
  if(expectedTypes) throw new Error("Incomplete final RDB header");
  return records;
}

function dayCount(year){return (Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000;}
function dateRuns(dates){
  const runs=[]; for(const date of dates){const last=runs[runs.length-1];if(last && Date.parse(date)-Date.parse(last.end)===86400000){last.end=date;last.days++;}else runs.push({start:date,end:date,days:1});}return runs;
}
function summarize(records, selected, years){
  const seen=new Map();for(const r of records){const key=[r.site_no,r.ts_id,r.date].join("/");if(seen.has(key))throw new Error("Duplicate original daily series/date: "+key);seen.set(key,r);}
  const allowed=new Set(selected.map(r=>r.site_no+"/"+r.ts_id));for(const r of records){if(!allowed.has(r.site_no+"/"+r.ts_id))throw new Error("Response contains a different source series: "+r.site_no+"/"+r.ts_id);}
  const out=[];
  for(const source of selected){
    const station={site_no:source.site_no,station_nm:source.station_nm,source_huc8:source.huc_cd,ts_id:source.ts_id,latitude:source.dec_lat_va,longitude:source.dec_long_va,coordinate_datum:source.dec_coord_datum_cd,catalog_begin:source.begin_date,catalog_end:source.end_date,years:[]};
    for(const year of years){
      const rows=records.filter(r=>r.site_no===source.site_no&&r.ts_id===source.ts_id&&r.date.startsWith(String(year)+"-")).sort((a,b)=>a.date.localeCompare(b.date));
      const byDate=new Map(rows.map(r=>[r.date,r]));const numeric=rows.filter(r=>r.value_cfs!==null);const missing=[],nonNumeric=[];
      for(let day=Date.UTC(year,0,1);day<Date.UTC(year+1,0,1);day+=86400000){
        const date=new Date(day).toISOString().slice(0,10);if(!byDate.has(date))missing.push(date);else if(byDate.get(date).value_cfs===null)nonNumeric.push(date);
      }
      const q={};for(const row of rows)q[row.qualifiers]=(q[row.qualifiers]||0)+1;
      const sorted=numeric.map(r=>r.value_cfs).sort((a,b)=>a-b);const sum=numeric.reduce((a,r)=>a+r.value_cfs,0);
      station.years.push({year,calendar_days:dayCount(year),source_record_count:rows.length,numeric_day_count:numeric.length,missing_date_count:missing.length,non_numeric_count:nonNumeric.length,calendar_numeric_fraction:numeric.length/dayCount(year),first_source_date:rows[0]?.date??null,last_source_date:rows[rows.length-1]?.date??null,qualifier_counts:q,approved_numeric_days:numeric.filter(r=>r.qualifiers.split(":").includes("A")).length,estimated_numeric_days:numeric.filter(r=>r.qualifiers.split(":").includes("e")).length,provisional_numeric_days:numeric.filter(r=>r.qualifiers.split(":").includes("P")).length,minimum_observed_daily_cfs:sorted[0]??null,maximum_observed_daily_cfs:sorted[sorted.length-1]??null,mean_observed_daily_cfs:numeric.length?sum/numeric.length:null,missing_date_ranges:dateRuns(missing),non_numeric_date_ranges:dateRuns(nonNumeric)});
    }
    out.push(station);
  }
  return out;
}

export {parseDaily,summarize};
const csvCell=x=>x===null||x===undefined?"":/[\n\r,"]/.test(String(x))?'"'+String(x).replaceAll('"','""')+'"':String(x);
function csv(rows,columns){return columns.join(",")+"\n"+rows.map(r=>columns.map(k=>csvCell(r[k])).join(",")).join("\n")+"\n";}
export function derive(originals,manifest){
  const years=[2020,2021,2022,2023,2024,2025];
  const records=years.flatMap(year=>parseDaily(originals["original/usgs-huc05-07-daily-discharge-"+year+".tsv"],year,"original/usgs-huc05-07-daily-discharge-"+year+".tsv"));
  const coverage=summarize(records,manifest.selection.selected_series,years);
  const sorted=records.slice().sort((a,b)=>a.site_no.localeCompare(b.site_no)||a.date.localeCompare(b.date)||a.ts_id.localeCompare(b.ts_id));
  const daily=csv(sorted,["site_no","ts_id","date","reported_value","value_cfs","qualifiers","source_path","source_line"]);
  const coverageCSV=csv(coverage.flatMap(s=>s.years.map(y=>({...s,...y}))),["site_no","station_nm","source_huc8","ts_id","year","calendar_days","source_record_count","numeric_day_count","missing_date_count","non_numeric_count","approved_numeric_days","estimated_numeric_days","provisional_numeric_days","minimum_observed_daily_cfs","maximum_observed_daily_cfs","mean_observed_daily_cfs"]);
  return {records,coverage,daily,coverageCSV};
}
async function main(){
  const root=resolve(process.argv[2]||".");
  const output=resolve(process.argv[3]||root+"/derived");
  const manifest=JSON.parse(await readFile(resolve(root,"source-manifest.json"),"utf8"));
  if(manifest.schema!=="upstate.original-discharge-source/v1")throw new Error("Choose the retained original discharge source manifest");
  const originals={};
  for(const entry of manifest.originals){
    if(!entry.path || entry.path.startsWith("/") || entry.path.split("/").some(p=>p===".."||p==="."||!p))throw new Error("Invalid original source path");
    const path=resolve(root,entry.path);
    if(relative(root,path).startsWith(".."))throw new Error("Source path leaves package");
    const body=await readFile(path);
    if(body.length!==entry.bytes || createHash("sha256").update(body).digest("hex")!==entry.sha256)throw new Error("Original response differs: "+entry.path);
    originals[entry.path]=body.toString("utf8");
  }
  const result=derive(originals,manifest);
  await mkdir(output,{recursive:true});
  await writeFile(resolve(output,"daily-discharge.csv"),result.daily);
  await writeFile(resolve(output,"station-year-coverage.csv"),result.coverageCSV);
  await writeFile(resolve(output,"station-year-coverage.json"),JSON.stringify(result.coverage,null,2)+"\n");
  process.stdout.write(JSON.stringify({originals:manifest.originals.length,records:result.records.length,numeric:result.records.filter(r=>r.value_cfs!==null).length,station_years:result.coverage.reduce((n,s)=>n+s.years.length,0),output},null,2)+"\n");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{process.stderr.write(error.message+"\n");process.exitCode=1;});
}
