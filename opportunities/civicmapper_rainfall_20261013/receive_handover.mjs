#!/usr/bin/env node
// Operate the actual assembled handover and inspect its original downloads.
// Uses an existing Playwright/Chromium installation. Makes no provider request.
import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import "./core.js";
const execute=promisify(execFile),args={},words=process.argv.slice(2);
for(let i=0;i<words.length;i+=2){if(!words[i]?.startsWith("--")||!words[i+1])throw Error("Use --option value pairs.");args[words[i].slice(2)]=words[i+1];}
if(!args.dir||!args.out)throw Error("Use --dir HANDOVER_DIRECTORY --out NEW_RECEIVING_DIRECTORY [--playwright MODULE_PATH] [--chromium EXECUTABLE] [--python PYTHON].");
const root=path.resolve(args.dir),output=path.resolve(args.out),sha=data=>createHash("sha256").update(data).digest("hex");
await fs.mkdir(output,{recursive:false});
const steps=[],images=[],downloads=[],errors=[],started=new Date().toISOString();
let browser;
const record=(action,details={})=>steps.push({action,at:new Date().toISOString(),...details});
function assert(condition,message){if(!condition)throw Error(message);}
async function snapshot(page,name){
 await page.screenshot({path:path.join(output,name),fullPage:true});const raw=await fs.readFile(path.join(output,name));images.push({file:name,bytes:raw.length,sha256:sha(raw)});
}
async function getDownload(page,button,name){
 const pending=page.waitForEvent("download");await page.locator(button).click();const download=await pending;
 const target=path.join(output,name);await download.saveAs(target);const data=await fs.readFile(target);
 downloads.push({file:name,bytes:data.length,sha256:sha(data)});return data.toString("utf8");
}
async function fit(page,name){
 const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
 assert(size.document<=size.viewport+1,name+" overflows the viewport: "+JSON.stringify(size));record("viewport", {name,...size});
}
async function saveResult(status,error=null){
 const result={schema:"rainfall-native-receiving/v1",started_at:started,completed_at:new Date().toISOString(),status,source_directory:root,steps,images,downloads,page_errors:errors,error,visual_inspection:"Producer must open and personally view all listed PNGs and actual outgoing files before presentation."};
 await fs.writeFile(path.join(output,"receiving.json"),JSON.stringify(result,null,2)+"\n");return result;
}
try{
 const manifestText=await fs.readFile(path.join(root,"manifest.json"),"utf8"),manifest=JSON.parse(manifestText);
 for(const item of manifest.files){const p=path.resolve(root,item.path);assert(p.startsWith(root+path.sep),"Invalid manifest path.");const raw=await fs.readFile(p);assert(raw.length===item.bytes&&sha(raw)===item.sha256,"Original member differs: "+item.path);}
 const originalProject=JSON.parse(await fs.readFile(path.join(root,"review-project.json"),"utf8")),original=RainfallReview.reopen(originalProject);
 record("original_complete_package",{manifest_sha256:sha(manifestText),members:manifest.files.length,fingerprints:original.releases.map(r=>r.fingerprint)});
 const playwright=await import(args.playwright?pathToFileURL(path.resolve(args.playwright)).href:"playwright");
 browser=await playwright.chromium.launch({headless:true,...(args.chromium?{executablePath:path.resolve(args.chromium)}:{})});
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:1365,height:950}});
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(root,"source/index.html")).href);
 assert(await page.locator("#empty").isVisible(),"Empty reviewer must be visible.");
 for(const id of ["save","report","csv","clear"])assert(await page.locator("#"+id).isDisabled(),"Empty control must be disabled: "+id);
 await snapshot(page,"01-empty-desktop.png");record("empty_controls");
 await page.locator("#files").setInputFiles({name:"invalid.json",mimeType:"application/json",buffer:Buffer.from("{not json")});
 await page.locator("#status.error").waitFor();assert(await page.locator("#load").isEnabled(),"Load remains usable after invalid input.");
 await snapshot(page,"02-invalid-input.png");record("invalid_input_recovery");
 await page.goto(pathToFileURL(path.join(root,"reviewer.html")).href);
 await page.locator("#review").waitFor({state:"visible"});
 await page.waitForFunction(()=>document.querySelector("#status").textContent.startsWith("Loaded "));
 assert(await page.locator(".release").count()===original.releases.length,"Prepared reviewer release count differs.");
 assert(await page.locator("#notes").inputValue()===original.notes,"Prepared notes differ.");
 await fit(page,"prepared desktop");await snapshot(page,"03-prepared-desktop.png");record("prepared_originals_opened");
 const ids=original.releases[0].metadata.sensors;
 for(const id of ids){await page.locator("#sensor").selectOption(id);assert(await page.locator("#sensor").inputValue()===id,"Sensor selection failed.");}
 for(const value of ["gaps","changes","all"]){await page.locator("#filter").selectOption(value);assert(await page.locator("#filter").inputValue()===value,"Table selection failed.");}
 await page.locator("#sensor").selectOption(ids[0]);
 if(await page.locator("#next").isEnabled()){await page.locator("#next").click();assert((await page.locator("#pagination").textContent()).includes("Page 2"),"Next interval page failed.");await page.locator("#prev").click();}
 record("sensor_filters_pagination",{sensors:ids});
 // Current working notes are edited in the actual UI and must survive the download/reopen.
 const notes=original.notes+"\nNative receiving: saved-project continuation checked "+started;
 await page.locator("#notes").fill(notes);
 const savedText=await getDownload(page,"#save","downloaded-review-project.json"),saved=RainfallReview.reopen(JSON.parse(savedText));
 assert(saved.notes===notes,"Saved notes differ.");
 assert(JSON.stringify(saved.releases.map(r=>r.capture))===JSON.stringify(original.releases.map(r=>r.capture)),"Download changed an original capture.");
 const csv=await getDownload(page,"#csv","downloaded-intervals.csv");
 const expected=original.releases.length===2?RainfallReview.compare(...original.releases).rows:RainfallReview.intervalRows(original.releases[0]);
 assert(csv===RainfallReview.csv(expected),"Downloaded CSV omitted or changed intervals.");
 const report=await getDownload(page,"#report","downloaded-report.html");
 assert(report===RainfallReview.report(original.releases,notes),"Downloaded report differs from the retained selection.");
 record("actual_downloads",{interval_rows:expected.length});
 await page.setViewportSize({width:390,height:844});await fit(page,"prepared narrow");await snapshot(page,"04-prepared-narrow.png");
 await page.locator("#clear").click();assert(await page.locator("#empty").isVisible(),"Clear did not restore empty state.");
 await page.locator("#files").setInputFiles(path.join(output,"downloaded-review-project.json"));
 await page.locator("#review").waitFor({state:"visible"});assert(await page.locator("#notes").inputValue()===notes,"Saved project did not reopen.");
 await snapshot(page,"05-reopened-narrow.png");record("clear_and_reopen");
 await page.locator("[data-remove]").last().click();assert(await page.locator(".release").count()===Math.max(0,original.releases.length-1),"Remove release failed.");
 assert(await page.locator("#load").isEnabled(),"Remove release left Load disabled.");record("remove_release");
 await page.goto(pathToFileURL(path.join(output,"downloaded-report.html")).href);await fit(page,"downloaded report narrow");await snapshot(page,"06-report-narrow.png");
 await page.setViewportSize({width:1365,height:950});await snapshot(page,"07-report-desktop.png");
 await page.goto(pathToFileURL(path.join(root,"OPEN_FIRST.html")).href);await snapshot(page,"08-opening-desktop.png");
 await page.setViewportSize({width:390,height:844});await fit(page,"opening narrow");await snapshot(page,"09-opening-narrow.png");
 // Extract the actual ZIP with Python's independent standard ZIP reader.
 const received=path.join(output,"received");
 const zipBytes=await fs.readFile(path.join(root,"rainfall-handover.zip")),build=JSON.parse(await fs.readFile(path.join(root,"BUILD.json"),"utf8"));
 assert(zipBytes.length===build.zip.bytes&&sha(zipBytes)===build.zip.sha256,"The full original ZIP differs from its build receipt.");
 await execute(args.python||"python3",["-c","import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[2]);p.mkdir()\nwith zipfile.ZipFile(sys.argv[1]) as z:\n import json\n expected=set(json.loads(sys.argv[3]))\n if set(z.namelist())!=expected or len(z.namelist())!=len(expected): raise ValueError(\u0027archive roster differs\u0027)\n for n in z.namelist():\n  q=pathlib.PurePosixPath(n)\n  if q.is_absolute() or '..' in q.parts or '\\\\' in n: raise ValueError('unsafe archive path')\n z.extractall(p)\n",path.join(root,"rainfall-handover.zip"),received,JSON.stringify([...manifest.files.map(x=>x.path),"manifest.json"])]);
 const receivedManifest=await fs.readFile(path.join(received,"manifest.json"),"utf8");assert(receivedManifest===manifestText,"ZIP manifest differs.");
 for(const item of manifest.files){const data=await fs.readFile(path.join(received,item.path));assert(data.length===item.bytes&&sha(data)===item.sha256,"Received member differs: "+item.path);}
 record("independent_zip_receive",{members:manifest.files.length+1});
 await context.close();
 const cold=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844}}),coldPage=await cold.newPage();coldPage.on("pageerror",e=>errors.push(e.message));
 await coldPage.goto(pathToFileURL(path.join(received,"reviewer.html")).href);
 await coldPage.locator("#review").waitFor({state:"visible"});
 assert(await coldPage.locator(".release").count()===original.releases.length,"Cold received reviewer differs.");
 assert(await coldPage.locator("#notes").inputValue()===original.notes,"Cold original handover notes differ.");
 await fit(coldPage,"cold received narrow");await snapshot(coldPage,"10-cold-received-narrow.png");
 const coldProject=JSON.parse(await getDownload(coldPage,"#save","cold-received-project.json"));
 assert(JSON.stringify(coldProject)===JSON.stringify(originalProject),"Cold received saved project differs.");
 record("cold_received_original_project");
 assert(!errors.length,"Browser errors: "+errors.join("; "));
 await browser.close();browser=null;const result=await saveResult("completed");process.stdout.write(JSON.stringify({status:result.status,output,images:images.map(x=>x.file),downloads:downloads.map(x=>x.file)},null,2)+"\n");
}catch(e){if(browser)await browser.close();await saveResult("failed",e.stack||e.message);process.stderr.write(e.stack||e.message);process.exitCode=1;}
