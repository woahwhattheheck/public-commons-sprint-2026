import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,join,isAbsolute} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash,randomUUID} from "node:crypto";
const options={};
for(let i=2;i<process.argv.length;i+=2){
  const name=process.argv[i],value=process.argv[i+1];
  if(!/^--[a-z0-9-]+$/.test(name)||value===undefined||options[name]!==undefined)throw new Error("Use each named option once with its actual value.");
  options[name]=value;
}
for(const key of ["--startup","--output","--playwright-module","--browser-executable"])if(!options[key])throw new Error("Missing "+key);
const startup=JSON.parse(await readFile(options["--startup"],"utf8"));
const output=resolve(options["--output"]);
await mkdir(output,{recursive:true,mode:0o700});
const attempt=join(output,"review-"+randomUUID());
await mkdir(attempt,{mode:0o700});
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const modulePath=options["--playwright-module"];
const driver=await import(isAbsolute(modulePath)?pathToFileURL(modulePath).href:modulePath);
const chromium=driver.chromium||driver.default?.chromium;
if(!chromium)throw new Error("The selected installed Playwright module has no Chromium driver.");
const result={schema:"lake-county.buyer-browser-review/v1",workspace_id:startup.workspace_id,publication_id:startup.publication_id,
  complete:false,page_errors:[],overflow:[],screens:[],downloads:[],started_at:new Date().toISOString()};
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:options["--browser-executable"],
    args:["--no-sandbox","--disable-dev-shm-usage"]});
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const page=await context.newPage();
  page.on("pageerror",error=>result.page_errors.push(error.message));
  await page.goto(startup.origin+"/#token="+encodeURIComponent(startup.token),{waitUntil:"domcontentloaded"});
  await page.locator("#main h1").waitFor({state:"visible",timeout:30000});
  const views=[["overview","Program overview"],["sources","Sources & editions"],["registers","Registers"],["exchange","Model exchange"],
    ["scenarios","Capital scenarios"],["decisions","Review decisions"],["handover","Handover"]];
  for(const [width,kind] of [[1440,"desktop"],[390,"phone"]]){
    await page.setViewportSize({width,height:width===390?844:1000});
    for(const [tab,title] of views){
      await page.locator('#navigation button[data-tab="'+tab+'"]').click();
      await page.locator('#navigation button[data-tab="'+tab+'"][aria-current="page"]').waitFor();
      if(tab==="registers")await page.waitForFunction(()=>!document.querySelector("#main")?.innerText.includes("Loading the selected original records"));
      await page.evaluate(()=>document.fonts.ready);
      const dimensions=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
      if(dimensions.documentWidth>dimensions.width+1)result.overflow.push({kind,tab,...dimensions});
      const path=join(attempt,kind+"-"+tab+".png");
      await page.screenshot({path,fullPage:true});
      const bytes=await readFile(path);
      result.screens.push({kind,section:tab,title,path,bytes:bytes.length,sha256:sha(bytes),...dimensions});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#navigation button[data-tab="handover"]').click();
  const report=page.waitForEvent("download");
  await page.locator('[data-download-report="'+startup.publication_id+'"]').click();
  const reportDownload=await report;
  const reportPath=join(attempt,"Lake_County_Capital_Program_Report.html");
  await reportDownload.saveAs(reportPath);
  const reportBytes=await readFile(reportPath);
  if(sha(reportBytes)!==startup.report_sha256)throw new Error("The actual browser report differs from the frozen original report.");
  result.downloads.push({kind:"report",path:reportPath,bytes:reportBytes.length,sha256:sha(reportBytes)});
  const archive=page.waitForEvent("download",{timeout:120000});
  await page.locator('[data-download-publication="'+startup.publication_id+'"]').click();
  const archiveDownload=await archive;
  const archivePath=join(attempt,"Lake_County_Capital_Program_Browser_Download.zip");
  await archiveDownload.saveAs(archivePath);
  const archiveBytes=await readFile(archivePath);
  result.downloads.push({kind:"complete_workspace",path:archivePath,bytes:archiveBytes.length,sha256:sha(archiveBytes)});
  result.complete=result.page_errors.length===0&&result.overflow.length===0;
}catch(error){
  result.error=error.message;
}finally{
  if(browser)await browser.close();
  result.completed_at=new Date().toISOString();
  await writeFile(join(attempt,"review.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});
}
process.stdout.write(JSON.stringify(result)+"\n");
if(!result.complete)process.exitCode=2;
