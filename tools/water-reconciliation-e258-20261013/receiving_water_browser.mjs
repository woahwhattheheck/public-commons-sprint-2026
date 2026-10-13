#!/usr/bin/env node
/**
 * Operate the actual completed water case inspector and cold-open its exports.
 * No new data, calculation, network source, dependency install or case mutation.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {isDeepStrictEqual} from "node:util";

const SCHEMA = "tjlabs.water-reconciliation.browser-receiving.v1";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const check = (condition, message) => {if (!condition) throw new Error(message);};
const args = {};
for (let i=2;i<process.argv.length;i++) {
  const name=process.argv[i];
  check(["--receiving","--output","--playwright","--chromium","--resume"].includes(name), "Unknown argument "+name);
  if (name==="--resume") args.resume=true;
  else {check(process.argv[i+1]&&!process.argv[i+1].startsWith("--"), "Missing value "+name);args[name.slice(2)]=process.argv[++i];}
}
for (const key of ["receiving","output","playwright","chromium"]) check(args[key], "Required --"+key);
const root=path.resolve(args.output), receivingPath=path.resolve(args.receiving);
const receivingBytes=await fs.readFile(receivingPath), receiving=JSON.parse(receivingBytes);
check(receiving.schema==="tjlabs.water-reconciliation.receiving.v1"&&receiving.status==="COMPLETE",
      "Use the original completed receiving.json");
check(Array.isArray(receiving.rendered_reports)&&receiving.rendered_reports.length>=3,
      "Original, later and cold report paths are required");
const nativeRoot=path.dirname(receivingPath);
function contained(file,base) {const rel=path.relative(base,file);return rel!==""&&!rel.startsWith(".."+path.sep)&&rel!==".."&&!path.isAbsolute(rel);}
const reports=[];
for(const supplied of receiving.rendered_reports) {
  const file=path.resolve(nativeRoot,supplied), real=await fs.realpath(file), realRoot=await fs.realpath(nativeRoot);
  check(contained(real,realRoot)&&path.basename(real)==="report.html","Report must be retained in the original native case");
  const caseDir=path.dirname(path.dirname(real));
  const [html,result,sourceReport,manifest]=await Promise.all([
    fs.readFile(real),fs.readFile(path.join(caseDir,"water/result.json")),
    fs.readFile(path.join(caseDir,"report.json")),fs.readFile(path.join(caseDir,"manifest.json"))
  ]);
  const value=JSON.parse(result);
  check(value.schema==="tjlabs.water-reconciliation.result.v1","Unexpected water result");
  reports.push({path:real,caseDir,sha256:sha(html),bytes:html.length,
    resultText:result.toString("utf8"),reportText:sourceReport.toString("utf8"),
    manifestText:manifest.toString("utf8"),result:value});
}
const helperPath=await fs.realpath(new URL(import.meta.url));
const input={schema:SCHEMA,receiving_path:receivingPath,receiving_sha256:sha(receivingBytes),
  helper_sha256:sha(await fs.readFile(helperPath)),playwright:await fs.realpath(args.playwright),
  chromium:await fs.realpath(args.chromium),
  reports:reports.map(r=>({path:r.path,bytes:r.bytes,sha256:r.sha256,source_run_identity:r.result.source_run_identity}))};
const inputText=JSON.stringify(input,null,2)+"\n";
async function atomic(file,body,replace=false) {
  const temporary=path.join(path.dirname(file),"."+path.basename(file)+"-"+crypto.randomUUID()+".tmp");
  let handle=null;
  try {
    handle=await fs.open(temporary,"wx");await handle.writeFile(body);await handle.sync();await handle.close();handle=null;
    if(replace)await fs.rename(temporary,file);else await fs.link(temporary,file);
  } finally {
    if(handle)await handle.close().catch(()=>{});
    await fs.unlink(temporary).catch(error=>{if(error.code!=="ENOENT")throw error;});
  }
}
try {await fs.mkdir(root);} catch(error) {if(error.code!=="EEXIST")throw error;check(args.resume,"Existing output requires --resume");}
for(const report of reports)check(root!==report.caseDir&&!contained(root,report.caseDir),"Keep browser output outside the immutable native case directories");
const inputPath=path.join(root,"browser-input.json");
try {await atomic(inputPath,inputText);}
catch(error) {if(error.code!=="EEXIST")throw error;check((await fs.readFile(inputPath,"utf8"))===inputText,"Restore the exact original input/source/runtime selections");}
const lockPath=path.join(root,"browser.lock"),owner={hostname:os.hostname(),pid:process.pid,token:crypto.randomUUID()};
let ownsLock=false,browser=null;
const steps=[],artifacts=[],errors=[];
let attemptDir=null,browserVersion=null;
async function save(name,body) {
  const file=path.join(attemptDir,name);await fs.writeFile(file,body,{flag:"wx"});
  const data=await fs.readFile(file);artifacts.push({path:path.relative(root,file).split(path.sep).join("/"),bytes:data.length,sha256:sha(data)});
  return file;
}
async function retained(file) {
  const data=await fs.readFile(file);artifacts.push({path:path.relative(root,file).split(path.sep).join("/"),bytes:data.length,sha256:sha(data)});
  return file;
}
async function step(name,fn) {
  const result=await fn();steps.push({name,status:"COMPLETE",result:result??null});
  await atomic(path.join(attemptDir,"progress.json"),JSON.stringify({input_sha256:sha(Buffer.from(inputText)),steps,artifacts},null,2)+"\n",true);
  return result;
}
async function capture(page,name) {
  const file=path.join(attemptDir,name);await page.screenshot({path:file,fullPage:true});await retained(file);
}
async function downloaded(page,button,name) {
  const waiting=page.waitForEvent("download",{timeout:30000});await page.locator(button).click();
  const item=await waiting;check(!(await item.failure()),"Actual download failed: "+name);
  const file=path.join(attemptDir,name);await item.saveAs(file);await retained(file);return file;
}
async function waitApp(page,file) {
  await page.goto(pathToFileURL(file).href,{waitUntil:"domcontentloaded",timeout:60000});
  await page.locator("#summary .stat").first().waitFor({timeout:30000});
  check(await page.locator("#fatal").isHidden(),"Report displayed a rendering error");
}
async function readPayload(page,report) {
  const payload=await page.locator("#water-payload").textContent(), value=JSON.parse(payload);
  check(value.schema==="tjlabs.water-reconciliation.offline-report.v1","Unexpected embedded case schema");
  check(value.result_json===report.resultText&&value.source_report_json===report.reportText&&value.original_manifest_json===report.manifestText,
        "Complete embedded JSON texts must equal the actual original files");
  return value;
}
async function selectPeriod(page,report,index) {
  await page.locator("#tab-overview").click();await page.locator("#period-filter").fill(report.result.results[index].period_id);
  await page.locator('#period-list [data-period="'+index+'"]').click();
  await page.locator("#period-filter").fill("");
}
try {
  try {await atomic(lockPath,JSON.stringify(owner));ownsLock=true;}
  catch(error) {
    if(error.code!=="EEXIST")throw error;
    const previous=JSON.parse(await fs.readFile(lockPath,"utf8"));
    check(args.resume&&previous.hostname===os.hostname()&&Number.isInteger(previous.pid),
          "Original browser lock remains owned; coordinate its owner rather than starting another course");
    let live=true;try {process.kill(previous.pid,0);}catch(e){if(e.code==="ESRCH")live=false;else throw e;}
    check(!live,"Original browser process is still active");
    check((await fs.readFile(lockPath,"utf8"))===JSON.stringify(previous),"Original browser lock changed");
    await fs.rename(lockPath,path.join(root,"retired-lock-"+previous.token+".json"));
    await atomic(lockPath,JSON.stringify(owner));ownsLock=true;
  }
  const outcomePath=path.join(root,"browser-receiving.json");
  try {
    const previous=JSON.parse(await fs.readFile(outcomePath,"utf8"));
    if(previous.status==="BROWSER_COURSE_COMPLETE") {
      check(previous.input_sha256===sha(Buffer.from(inputText)),"Completed source selection differs");
      for(const item of previous.artifacts) {
        const file=path.resolve(root,item.path);check(contained(file,root),"Artifact path escaped receiving output");
        const data=await fs.readFile(file);check(data.length===item.bytes&&sha(data)===item.sha256,"Completed artifact changed: "+item.path);
      }
      console.log(JSON.stringify(previous));process.exitCode=0;
    }
  } catch(error) {if(error.code!=="ENOENT")throw error;}
  if(process.exitCode===0) {
    // A complete original course is returned only after every saved artifact is checked.
  } else {
    attemptDir=await fs.mkdtemp(path.join(root,"attempt-"));
    const module=await import(pathToFileURL(input.playwright).href),chromium=module.chromium??module.default?.chromium;
    check(chromium?.launch,"Selected installed Playwright module must expose chromium");
    browser=await chromium.launch({headless:true,executablePath:input.chromium,args:["--disable-dev-shm-usage"]});
    browserVersion=browser.version();await save("browser-runtime.json",JSON.stringify({browser_version:browserVersion,playwright:input.playwright,chromium:input.chromium},null,2)+"\n");
    const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true,serviceWorkers:"block"});
    await context.setOffline(true);
    const page=await context.newPage();
    page.on("pageerror",error=>errors.push(String(error)));
    const report=reports[0];
    await step("open-original-complete-report",async()=>{await waitApp(page,report.path);await readPayload(page,report);await capture(page,"01-original-overview-desktop.png");return {source_run_identity:report.result.source_run_identity,periods:report.result.selected_periods};});
    const eligible=report.result.results.findIndex(r=>r.account_id&&r.billing&&r.patterns?.status==="COMPLETE");
    check(eligible>=0,"Actual course needs one calculated period from its existing native result");
    const chosen=report.result.results[eligible];
    await step("operate-period-account-status-filters",async()=>{
      await page.locator("#account-filter").selectOption(chosen.account_id);
      check(await page.locator("#period-list").innerText().then(t=>t.includes(chosen.period_id)),"Selected account must expose its original period");
      await page.locator("#review-filter").selectOption("issues");
      const expected=report.result.results.filter(r=>r.account_id===chosen.account_id&&r.issues.length).length;
      check((await page.locator("#filter-count").textContent()).startsWith(expected+" of "),"Review filter must retain actual population count");
      await page.locator("#reset-filters").click();await selectPeriod(page,report,eligible);
      await page.locator("#exact-values").check();return {account:chosen.account_id,period:chosen.period_id};
    });
    await step("verify-original-record-drilldown",async()=>{
      const refButton=page.locator("#period-detail [data-source]").first(),ref=JSON.parse(await refButton.getAttribute("data-source"));
      const source=report.result.source_inputs.find(x=>x.table===ref.table);check(source,"Drilldown source belongs to native inventory");
      const file=path.resolve(report.caseDir,source.retained_path);check(contained(file,report.caseDir),"Retained input path");
      const data=await fs.readFile(file);check(data.length===source.bytes&&sha(data)===source.sha256,"Actual source bytes match result");
      await refButton.click();await page.locator("#source-file").setInputFiles(file);
      await page.waitForFunction(()=>document.getElementById("source-status")?.textContent.includes("Complete original file verified"),null,{timeout:60000});
      await page.locator("#source-go").click();await capture(page,"02-verified-original-source.png");
      await page.keyboard.press("Escape");check(await page.locator("#source-dialog").isHidden(),"Escape closes source dialog");
      return {table:ref.table,record:ref.record,bytes:source.bytes,sha256:source.sha256};
    });
    await step("review-exact-comparison-and-charge-lines",async()=>{
      await page.locator("#tab-comparisons").click();await page.locator("#compare-b").selectOption(String(Math.min(1,report.result.results.length-1)));
      check((await page.locator("#panel-comparisons").innerText()).includes("Exact right − left"),"Whole period comparison displayed");
      await capture(page,"03-exact-comparisons.png");await page.locator("#tab-charges").click();
      check((await page.locator("#panel-charges").innerText()).includes(chosen.billing.amount.decimal_12),"Actual engine charge displayed");
      await capture(page,"04-water-charge-lines.png");return {tariff:chosen.billing.tariff_id,components:chosen.billing.components.length};
    });
    await step("review-daily-night-continuous-patterns",async()=>{
      await page.locator("#tab-patterns").click();await page.locator("#day-metric").selectOption("night_gallons");
      await page.locator("#qualifying-only").check();await page.locator("#qualifying-only").uncheck();
      const day=chosen.patterns.daily[0];await page.locator("#day-from").fill(day.local_date);await page.locator("#day-to").fill(day.local_date);
      check((await page.locator("#panel-patterns").innerText()).includes(day.local_date),"Actual local date displayed");
      await page.locator("#day-from").fill("");await page.locator("#day-to").fill("");
      await capture(page,"05-daily-night-continuous.png");return {status:chosen.patterns.status,days:chosen.patterns.daily.length,runs:chosen.patterns.continuous_runs.length};
    });
    await step("inspect-full-source-definitions-and-links",async()=>{
      await page.locator("#tab-sources").click();
      const source=report.result.source_inputs[0],link=page.locator("#panel-sources a[download]").filter({hasText:"Open retained "+source.table+".csv"});
      check((await link.getAttribute("href"))==="../"+source.retained_path,"Original source link retains exact case-relative path");
      await capture(page,"06-complete-source-definitions.png");
      return {source_files:report.result.source_inputs.length};
    });
    await step("keyboard-and-narrow-layout",async()=>{
      await page.locator("#tab-sources").focus();await page.keyboard.press("Home");
      check(await page.locator("#tab-overview").getAttribute("aria-selected")==="true","Keyboard Home selects first tab");
      await page.setViewportSize({width:390,height:844});await capture(page,"07-overview-narrow.png");
      await page.locator("#tab-patterns").click();await capture(page,"08-patterns-narrow.png");
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),"Narrow page does not overflow outside scrollable tables");
      await page.setViewportSize({width:1440,height:1050});return {narrow_width:390};
    });
    const exports=await step("download-complete-html-json-and-filtered-csv",async()=>{
      await page.locator("#period-filter").fill(chosen.period_id);
      const html=await downloaded(page,"#download-html","Water_Case_Inspector.html");
      const json=await downloaded(page,"#download-json","Water_Embedded_Case.json");
      const csv=await downloaded(page,"#download-csv","Water_Filtered_Overview.csv");
      const value=JSON.parse(await fs.readFile(json,"utf8"));
      check(value.result_json===report.resultText&&value.source_report_json===report.reportText&&value.original_manifest_json===report.manifestText,
            "Filtered view must export the complete original embedded documents");
      check((await fs.readFile(csv,"utf8")).includes(chosen.period_id),"Filtered CSV includes chosen actual period");
      return {html,json,csv};
    });
    await step("cold-open-downloaded-report-and-print-current-view",async()=>{
      const cold=await context.newPage();cold.on("pageerror",error=>errors.push(String(error)));
      await waitApp(cold,exports.html);await readPayload(cold,report);
      check(await cold.locator("#period-filter").inputValue()===chosen.period_id,"Downloaded HTML restores selected view");
      await cold.locator("#reset-filters").click();
      check((await cold.locator("#filter-count").textContent()).startsWith(report.result.results.length+" of "),"Cold downloaded report retains all periods");
      await cold.locator("#tab-charges").click();await capture(cold,"09-downloaded-report-cold.png");
      const pdf=path.join(attemptDir,"Water_Current_View.pdf");await cold.pdf({path:pdf,format:"A4",printBackground:true});await retained(pdf);
      await cold.close();return {all_periods:report.result.results.length,print_scope:"Current view only"};
    });
    await step("open-original-later-and-native-cold-reports",async()=>{
      const identities=[];
      for(let i=1;i<reports.length;i++) {
        await waitApp(page,reports[i].path);await readPayload(page,reports[i]);
        await capture(page,"10-native-report-"+i+".png");
        identities.push({source_run_identity:reports[i].result.source_run_identity,sha256:reports[i].sha256});
      }
      return identities;
    });
    check(errors.length===0,"Actual browser emitted errors: "+errors.join("; "));
    await browser.close();browser=null;
    const viewing=[
      "# Actual rendered water receiving — required viewing",
      "",
      "The native and browser courses operated the original completed files. The screenshots and print below are captured artifacts, not an assertion that a person/agent has viewed their pixels.",
      "",
      "Open and VIEW every PNG in this attempt at its actual dimensions. Inspect the full current-view PDF, including every page. Confirm readable full identifiers, exact values, coverage messages, source record dialog, narrow controls and table scrolling.",
      "",
      "Open Water_Case_Inspector.html from this attempt and operate its controls. Open Water_Embedded_Case.json and Water_Filtered_Overview.csv. Confirm the complete JSON retains all original selected periods while the labelled CSV carries only the chosen presentation filter.",
      "",
      "Preserve the full original native case and its Water_Case.zip beside these results. Do not replace it with the HTML inspection copy.",
      "",
      "Record actual viewer and outcome in the existing original receiving thread. Keep visual review pending until the actual screenshots/export pages have been viewed. Preserve current owner browser instructions and selected user tabs.",
      "",
      "TJLabs attribution remains in the report. Any later positive-contact customer message, contract or confidentiality agreement follows the owner's existing exact approval/signature rules.",
      ""
    ].join("\n");
    await save("VIEWING.md",viewing);
    const result={schema:SCHEMA,status:"BROWSER_COURSE_COMPLETE",input_sha256:sha(Buffer.from(inputText)),
      native_receiving_sha256:input.receiving_sha256,data_class:receiving.data_class,
      browser_version:browserVersion,
      steps,artifacts,visual_review:"PENDING_ACTUAL_SCREENSHOT_AND_EXPORT_VIEWING",
      native_operation:"Existing completed water receiving case; no new calculation or dataset"};
    await atomic(outcomePath,JSON.stringify(result,null,2)+"\n",true);
    console.log(JSON.stringify(result));
  }
} catch(error) {
  if(attemptDir) {
    const failure={schema:SCHEMA,status:"INCOMPLETE",input_sha256:sha(Buffer.from(inputText)),error:String(error),steps,artifacts,
      visual_review:"PENDING_ACTUAL_SCREENSHOT_AND_EXPORT_VIEWING"};
    await atomic(path.join(attemptDir,"failure.json"),JSON.stringify(failure,null,2)+"\n");
  }
  console.error(String(error));process.exitCode=2;
} finally {
  if(browser)await browser.close().catch(()=>{});
  if(ownsLock) {
    try {const current=JSON.parse(await fs.readFile(lockPath,"utf8"));if(current.token===owner.token)await fs.unlink(lockPath);}
    catch(error){if(error.code!=="ENOENT")console.error("Original lock retained: "+error);}
  }
}
