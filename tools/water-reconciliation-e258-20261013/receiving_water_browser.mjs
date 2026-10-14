#!/usr/bin/env node
/**
 * Operate the actual completed water case inspector and cold-open its exports.
 * No new data, calculation, network source, dependency install or case mutation.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import http from "node:http";
import {pathToFileURL} from "node:url";
import {isDeepStrictEqual} from "node:util";

const SCHEMA = "tjlabs.water-reconciliation.browser-receiving.v1";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const check = (condition, message) => {if (!condition) throw new Error(message);};
const args = {};
for (let i=2;i<process.argv.length;i++) {
  const name=process.argv[i];
  check(["--receiving","--output","--playwright","--chromium","--resume","--adopt-loopback","--inspection"].includes(name), "Unknown argument "+name);
  if (name==="--resume") args.resume=true;
  else if(name==="--adopt-loopback")args.adoptLoopback=true;
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
let inspection=null;
if(args.inspection) {
  check(!args.adoptLoopback,"Use a separate inspection output; original loopback adoption remains unchanged");
  const inspectionPath=await fs.realpath(args.inspection), inspectionBytes=await fs.readFile(inspectionPath);
  const selected=JSON.parse(inspectionBytes), expectedRenderer="c6ad4979676ccd8cb830b79c62be7320ea1c36b814f810ee86b2fa9ddd2bdd2d";
  check(selected.schema==="tjlabs.water-reconciliation.inspection-edition.v1"&&selected.status==="INSPECTION_RENDERED",
        "Select the complete source-bound presentation receipt");
  check(selected.native_receiving.path===receivingPath&&selected.native_receiving.bytes===receivingBytes.length&&
        selected.native_receiving.sha256===sha(receivingBytes),"Inspection must use this exact original native receiving");
  check(selected.renderer.sha256===expectedRenderer,"Select the exact reviewed Water presentation renderer");
  for(const descriptor of [selected.renderer,selected.producer,selected.input]) {
    const actual=await fs.realpath(descriptor.path), body=await fs.readFile(actual);
    check(actual===descriptor.path&&body.length===descriptor.bytes&&sha(body)===descriptor.sha256,"Inspection producer/source identity differs");
  }
  const staging=JSON.parse(await fs.readFile(selected.input.path,"utf8"));
  check(staging.schema==="tjlabs.water-reconciliation.inspection-input.v1"&&
        isDeepStrictEqual(staging.native_receiving,selected.native_receiving)&&
        isDeepStrictEqual(staging.renderer,selected.renderer)&&isDeepStrictEqual(staging.producer,selected.producer)&&
        selected.reports.length===reports.length&&staging.reports.length===reports.length,
        "Complete original inspection input differs");
  for(let i=0;i<reports.length;i++) {
    const r=reports[i], item=selected.reports[i], {presentation,...original}=item;
    check(isDeepStrictEqual(original,staging.reports[i])&&item.case===r.caseDir&&
          item.original_html.path===r.path&&item.original_html.bytes===r.bytes&&item.original_html.sha256===r.sha256&&
          item.source_run_identity===r.result.source_run_identity,"Inspection changed original native report selection");
    const originals=[["water/result.json",r.resultText],["report.json",r.reportText],["manifest.json",r.manifestText]];
    for(const [name,text] of originals) {
      const descriptor=item.documents[name], bytes=Buffer.from(text,"utf8");
      check(descriptor.path===path.join(r.caseDir,name)&&descriptor.bytes===bytes.length&&descriptor.sha256===sha(bytes),
            "Inspection original document differs: "+name);
    }
    check(item.source_inputs.length===r.result.source_inputs.length,"Inspection source inventory differs");
    for(let k=0;k<item.source_inputs.length;k++) {
      const source=item.source_inputs[k], native=r.result.source_inputs[k];
      check(source.table===native.table&&source.retained_path===native.retained_path&&
            source.path===path.join(r.caseDir,native.retained_path)&&source.bytes===native.bytes&&source.sha256===native.sha256,
            "Inspection original source binding differs");
    }
    const real=await fs.realpath(presentation.path), info=await fs.lstat(presentation.path), body=await fs.readFile(real);
    check(info.isFile()&&!info.isSymbolicLink()&&real===presentation.path&&contained(real,path.dirname(inspectionPath))&&
          !contained(real,nativeRoot)&&body.length===presentation.bytes&&sha(body)===presentation.sha256,
          "Inspection HTML must be its exact separately retained original presentation");
    r.originalPath=r.path;r.originalSha256=r.sha256;r.path=real;r.bytes=body.length;r.sha256=sha(body);
  }
  inspection={path:inspectionPath,bytes:inspectionBytes.length,sha256:sha(inspectionBytes),
    renderer_sha256:selected.renderer.sha256,meaning:selected.meaning};
}
const helperPath=await fs.realpath(new URL(import.meta.url));
const input={schema:SCHEMA,receiving_path:receivingPath,receiving_sha256:sha(receivingBytes),
  helper_sha256:sha(await fs.readFile(helperPath)),playwright:await fs.realpath(args.playwright),
  chromium:await fs.realpath(args.chromium),
  reports:reports.map(r=>({path:r.path,bytes:r.bytes,sha256:r.sha256,source_run_identity:r.result.source_run_identity}))};
if(inspection)input.inspection=inspection;
let inputText=JSON.stringify(input,null,2)+"\n";
const predecessorHelperSha256="2cb210396e81432344ab054306748c3bff90f617d2f0a4743b25a706cf829b15";
let adoption=null;
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
catch(error) {
  if(error.code!=="EEXIST")throw error;
  const originalText=await fs.readFile(inputPath,"utf8");
  if(originalText!==inputText) {
    const original=JSON.parse(originalText), selectedWithoutHelper={...input}, originalWithoutHelper={...original};
    delete selectedWithoutHelper.helper_sha256;delete originalWithoutHelper.helper_sha256;
    check(args.resume&&args.adoptLoopback&&original.helper_sha256===predecessorHelperSha256&&
          isDeepStrictEqual(selectedWithoutHelper,originalWithoutHelper),
          "Restore original input/source/runtime selections; only the explicit reviewed --adopt-loopback successor may replace its exact predecessor helper");
    adoption={schema:"tjlabs.water-reconciliation.browser-helper-adoption.v1",
      original_input_sha256:sha(Buffer.from(originalText)),original_helper_sha256:original.helper_sha256,
      selected_helper_sha256:input.helper_sha256,transport:"scoped-read-only-loopback-http",
      meaning:"Original native reports, runtimes, browser-input.json and incomplete attempts remain unchanged; only the original browser helper has this explicit source successor."};
    inputText=originalText;
  }
}
const lockPath=path.join(root,"browser.lock"),owner={hostname:os.hostname(),pid:process.pid,token:crypto.randomUUID()};
let ownsLock=false,browser=null,loopback=null;
const served=new Map(),fileUrls=new Map();
let loopbackOrigin=null,loopbackPrefix=null;
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
function media(file) {
  const ext=path.extname(file).toLowerCase();
  return ({".html":"text/html; charset=utf-8",".json":"application/json; charset=utf-8",
    ".csv":"text/csv; charset=utf-8",".png":"image/png",".pdf":"application/pdf"})[ext]??"application/octet-stream";
}
async function expose(file,route,expected=null) {
  check(route.startsWith("/")&&!route.split("/").includes("..")&&!served.has(route),"Unique selected loopback path required");
  const real=await fs.realpath(file), info=await fs.lstat(file);
  check(info.isFile()&&!info.isSymbolicLink()&&real===path.resolve(file),"Serve only the selected ordinary original file");
  check(reports.some(r=>real===r.path||contained(real,r.caseDir))||(attemptDir&&contained(real,attemptDir)),"Loopback source escaped selected presentation/case or current attempt");
  const body=await fs.readFile(real), identity={bytes:body.length,sha256:sha(body)};
  if(expected)check(identity.bytes===expected.bytes&&identity.sha256===expected.sha256,"Loopback original differs: "+path.basename(file));
  const value={path:real,...identity,media_type:media(real)};
  served.set(route,value);fileUrls.set(real,route);
}
async function startLoopback() {
  for(let i=0;i<reports.length;i++) {
    const r=reports[i],base="/case/"+i+"/";
    await expose(r.path,base+"water/report.html",{bytes:r.bytes,sha256:r.sha256});
    for(const name of ["water/result.json","report.json","manifest.json","manifest.original.json",
                       "manifest.receiving.json","water/selection.original.json","water/review-items.csv"]) {
      const file=path.join(r.caseDir,name);
      try {await expose(file,base+name);}catch(error){if(error.code!=="ENOENT")throw error;}
    }
    for(const source of r.result.source_inputs) {
      check(source.retained_path==="inputs/"+source.table+".csv"&&/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(source.table),
            "Original source route must retain its exact safe table path");
      await expose(path.join(r.caseDir,source.retained_path),base+source.retained_path,source);
    }
  }
  loopbackPrefix="/"+crypto.randomBytes(24).toString("hex");
  loopback=http.createServer(async(req,res)=>{
    const fail=(code,message)=>{res.writeHead(code,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});res.end(message);};
    try {
      if(req.method!=="GET"&&req.method!=="HEAD")return fail(405,"Read-only original files");
      if(req.headers.host!==new URL(loopbackOrigin).host||
         (req.headers.origin&&req.headers.origin!==loopbackOrigin)||
         ![undefined,"none","same-origin"].includes(req.headers["sec-fetch-site"]))return fail(403,"Original local origin required");
      const url=new URL(req.url,loopbackOrigin);
      if(url.origin!==loopbackOrigin||url.search||!url.pathname.startsWith(loopbackPrefix+"/"))return fail(404,"Selected original file not found");
      const item=served.get(url.pathname.slice(loopbackPrefix.length));
      if(!item)return fail(404,"Selected original file not found");
      const info=await fs.lstat(item.path);
      check(info.isFile()&&!info.isSymbolicLink()&&(await fs.realpath(item.path))===item.path,"Selected loopback file changed");
      const body=await fs.readFile(item.path);
      check(body.length===item.bytes&&sha(body)===item.sha256,"Selected loopback bytes changed");
      res.writeHead(200,{"Content-Type":item.media_type,"Content-Length":body.length,"Cache-Control":"no-store",
        "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Cross-Origin-Resource-Policy":"same-origin"});
      res.end(req.method==="HEAD"?undefined:body);
    }catch(error){if(!res.headersSent)fail(409,"Selected original file is unavailable or changed");else res.destroy();}
  });
  await new Promise((resolve,reject)=>{
    const failed=error=>{loopback.off("listening",ready);reject(error);};
    const ready=()=>{loopback.off("error",failed);resolve();};
    loopback.once("error",failed);loopback.once("listening",ready);loopback.listen(0,"127.0.0.1");
  });
  loopbackOrigin="http://127.0.0.1:"+loopback.address().port;
  await save("loopback-source-selection.json",JSON.stringify({schema:"tjlabs.water-reconciliation.loopback-source.v1",
    read_only:true,hostname:"127.0.0.1",port:loopback.address().port,helper_sha256:input.helper_sha256,
    files:[...served.entries()].map(([route,value])=>({route,...value})),
    meaning:"Ephemeral process-owned exact-byte HTTP presentation of the same retained files; no provider access or native calculation."},null,2)+"\n");
}
function presentationUrl(file) {
  const route=fileUrls.get(path.resolve(file));check(route&&loopbackOrigin,"Selected report must be registered with the original loopback server");
  return loopbackOrigin+loopbackPrefix+route;
}
async function waitApp(page,file) {
  await page.goto(presentationUrl(file),{waitUntil:"domcontentloaded",timeout:60000});
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
  if(adoption) {
    const file=path.join(root,"browser-helper-adoption.json"),body=JSON.stringify(adoption,null,2)+"\n";
    try {await atomic(file,body);}catch(error){if(error.code!=="EEXIST")throw error;check((await fs.readFile(file,"utf8"))===body,"Retain the original helper successor selection");}
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
    await startLoopback();
    await context.route("**/*",route=>{
      const url=new URL(route.request().url());
      return url.origin===loopbackOrigin&&url.pathname.startsWith(loopbackPrefix+"/")?route.continue():route.abort("blockedbyclient");
    });
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
      if(inspection) {
        for(const [tab,name] of [["comparisons","08a-comparisons-narrow"],["charges","08b-charges-narrow"],["patterns","08c-patterns-scroll"]]) {
          await page.locator("#tab-"+tab).click();
          const table=page.locator("#panel-"+tab+" .table-wrap:visible").first();
          await table.focus();
          const dimensions=await table.evaluate(element=>({width:element.clientWidth,content:element.scrollWidth}));
          check(dimensions.content>dimensions.width,"Narrow inspection must retain readable horizontally scrollable columns");
          await page.keyboard.press("ArrowRight");
          await table.evaluate(element=>{element.scrollLeft=element.scrollWidth;});
          await capture(page,name+".png");
          await table.evaluate(element=>{element.scrollLeft=0;});
        }
      }
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
    await expose(exports.html,"/case/0/water/Water_Case_Inspector.html");
    await step("cold-open-downloaded-report-and-print-current-view",async()=>{
      const cold=await context.newPage();cold.on("pageerror",error=>errors.push(String(error)));
      await waitApp(cold,exports.html);await readPayload(cold,report);
      check(await cold.locator("#period-filter").inputValue()===chosen.period_id,"Downloaded HTML restores selected view");
      await cold.locator("#reset-filters").click();
      check((await cold.locator("#filter-count").textContent()).startsWith(report.result.results.length+" of "),"Cold downloaded report retains all periods");
      await cold.locator("#tab-charges").click();await capture(cold,"09-downloaded-report-cold.png");
      const pdf=path.join(attemptDir,"Water_Current_View.pdf");await cold.pdf({path:pdf,format:"A4",preferCSSPageSize:true,printBackground:true});await retained(pdf);
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
      browser_version:browserVersion,helper_sha256:input.helper_sha256,
      transport:"scoped-read-only-loopback-http",helper_adoption:adoption,inspection,
      steps,artifacts,visual_review:"PENDING_ACTUAL_SCREENSHOT_AND_EXPORT_VIEWING",
      native_operation:"Existing completed water receiving case; no new calculation or dataset"};
    await atomic(outcomePath,JSON.stringify(result,null,2)+"\n",true);
    console.log(JSON.stringify(result));
  }
} catch(error) {
  if(attemptDir) {
    const failure={schema:SCHEMA,status:"INCOMPLETE",input_sha256:sha(Buffer.from(inputText)),error:String(error),helper_sha256:input.helper_sha256,transport:"scoped-read-only-loopback-http",helper_adoption:adoption,inspection,steps,artifacts,
      visual_review:"PENDING_ACTUAL_SCREENSHOT_AND_EXPORT_VIEWING"};
    await atomic(path.join(attemptDir,"failure.json"),JSON.stringify(failure,null,2)+"\n");
  }
  console.error(String(error));process.exitCode=2;
} finally {
  if(browser)await browser.close().catch(()=>{});
  if(loopback) {loopback.closeAllConnections();await new Promise(resolve=>loopback.close(()=>resolve()));}
  if(ownsLock) {
    try {const current=JSON.parse(await fs.readFile(lockPath,"utf8"));if(current.token===owner.token)await fs.unlink(lockPath);}
    catch(error){if(error.code!=="ENOENT")console.error("Original lock retained: "+error);}
  }
}
