import {readFile, writeFile, mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve, join, relative, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {buildInterpretation, supportRows} from "./interpretation.mjs";
import {parseCsv, writeCsv} from "../report_context/wqp/normalize_core.mjs";

const inputRoot=resolve(process.argv[2]||fileURLToPath(new URL("../report_context/",import.meta.url)));
const outputRoot=resolve(process.argv[3]||fileURLToPath(new URL("./",import.meta.url)));
const names=["continuous_monthly_ph.csv","surface_ranges.csv","study.json","wqp/derived/selected_chlorophyll.csv","wqp/study_flow_dates.csv","wqp/flow_context_methods.json"];
const bodies=await Promise.all(names.map(name=>readFile(join(inputRoot,name))));
const values=bodies.map(body=>body.toString("utf8"));
const inputs=names.map((path,i)=>({path:relative(outputRoot,join(inputRoot,path)).split(sep).join("/"),bytes:bodies[i].length,sha256:createHash("sha256").update(bodies[i]).digest("hex")}));
const result=buildInterpretation({monthlyPH:parseCsv(values[0]),surfaceRanges:parseCsv(values[1]),study:JSON.parse(values[2]),selectedChlorophyll:parseCsv(values[3]),flowDates:parseCsv(values[4]),inputs,sourceRoot:relative(outputRoot,inputRoot).split(sep).join("/")||"."});
await mkdir(outputRoot,{recursive:true});
await writeFile(join(outputRoot,"decision-interpretation.json"),JSON.stringify(result,null,2)+"\n");
await writeFile(join(outputRoot,"common-period-ph-support.csv"),writeCsv(supportRows(result)));
console.log(JSON.stringify({output:outputRoot,common_day_support:result.common_period_ph.map(r=>({site:r.site_id,days:r.days_daily_max_above_study_reference,total:r.observed_days})),october_dates:result.october_response_context.map(r=>r.date)}));
