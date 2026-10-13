#!/usr/bin/env node
// Complete original VentCRM packages in an existing authorized browser.
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath,pathToFileURL} from "node:url";
import {gunzipSync} from "node:zlib";
import Zip from "./host/connected_zip.cjs";
import {receiveOriginalPackages} from "./build-package-viewer.mjs";
import {previewVentCRMDocument as documentPreview} from "./package-viewer.mjs";
const require=createRequire(import.meta.url),here=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
function installedPlaywright(selected){
 let entry,packagePath;
 if(selected){
  entry=path.resolve(selected);let directory=path.dirname(entry);
  while(true){
   const candidate=path.join(directory,'package.json');
   if(fs.existsSync(candidate)){
    const p=JSON.parse(fs.readFileSync(candidate,'utf8'));
    if(['playwright','playwright-core'].includes(p.name)){packagePath=candidate;break;}
   }
   const parent=path.dirname(directory);if(parent===directory)break;directory=parent;
  }
 }else{
  for(const name of ['playwright','playwright-core']){
   try{entry=require.resolve(name);packagePath=require.resolve(name+'/package.json');break;}catch{}
  }
 }
 if(!entry||!packagePath)throw Error('Select the existing Playwright installation with --playwright-module; this course performs no installation.');
 const metadata=JSON.parse(fs.readFileSync(packagePath,'utf8'));
 const version=/^(\d+)\.(\d+)\./.exec(metadata.version);
 if(!version||Number(version[1])<1||(Number(version[1])===1&&Number(version[2])<60))throw Error('The selected existing Playwright must support connectOverCDP noDefaults (version 1.60 or later).');
 return {entry,metadata};
}

function options(args){
 const out={};
 for(let i=0;i<args.length;i++){const key=args[i];if(!["--out","--cdp","--playwright-module","--delivery"].includes(key)||!args[i+1]||args[i+1].startsWith("--")||out[key.slice(2)])throw Error("Use --delivery COMPLETE_BUILT_DIRECTORY --out NEW_DIRECTORY --cdp EXISTING_AUTHORIZED_ENDPOINT [--playwright-module EXISTING_ENTRY].");out[key.slice(2)]=args[++i];}
 if(!out.out||!out.cdp||!out.delivery)throw Error("The current authorized browser and a new output directory are required.");
 const endpoint=new URL(out.cdp);if(!["http:","https:","ws:","wss:"].includes(endpoint.protocol)||endpoint.username||endpoint.password)throw Error("Use the authorized CDP endpoint without embedded credentials.");
 return out;
}
async function run(){
 const args=options(process.argv.slice(2)),installed=installedPlaywright(args["playwright-module"]);
 const input=JSON.parse(fs.readFileSync(path.join(here,"package-viewer-input.json"),"utf8")),record=JSON.parse(fs.readFileSync(path.join(path.resolve(args.delivery),"working-record.json"),"utf8"));
 const packages=receiveOriginalPackages(record,input),html=fs.readFileSync(path.join(here,"VentCRM-complete-packages.html"),"utf8");
 const manifest=JSON.parse(fs.readFileSync(path.join(here,"source-manifest.json"),"utf8"));
 for(const file of manifest.files){if(path.isAbsolute(file.path)||file.path.split("/").includes(".."))throw Error("Invalid complete source path.");const b=fs.readFileSync(path.join(here,file.path));if(b.length!==file.bytes||hash(b)!==file.sha256)throw Error("Complete original source differs: "+file.path);}
 const out=path.resolve(args.out);fs.mkdirSync(out,{mode:0o700});for(const child of ["screens","downloads","source"])fs.mkdirSync(path.join(out,child),{mode:0o700});
 for(const name of ["VentCRM-complete-packages.html","package-viewer-input.json"])fs.copyFileSync(path.join(here,name),path.join(out,"source",name),fs.constants.COPYFILE_EXCL);
 fs.copyFileSync(path.join(path.resolve(args.delivery),"working-record.json"),path.join(out,"source","working-record.json"),fs.constants.COPYFILE_EXCL);
 const result={schema:"commons.ventcrm-complete-package-browser.v1",status:"RUNNING",source:manifest.files.find(x=>x.path==="VentCRM-complete-packages.html"),views:[],downloads:[],events:[],browser_errors:[],visual_inspection:"Producing peer must view the actual images and every customer attachment."};
 const save=()=>fs.writeFileSync(path.join(out,"run.json"),JSON.stringify(result,null,2)+"\n");
 const event=(stage,details={})=>{result.events.push({stage,...details});save();console.log(JSON.stringify({stage,...details}));};
 const origin="https://ventcrm-complete-package.invalid",routes=new Map([["/",html]]);
 for(const [i,p]of packages.entries())for(const m of Zip.readStoredZip(new Uint8Array(p.archive)))routes.set("/documents/"+i+"/"+encodeURIComponent(m.name),documentPreview(m.name,Zip.utf8Text(m.data)));
 const owned=new Set();let browser;
 save();
 try{
  const runtime=await import(pathToFileURL(installed.entry).href);const chromium=runtime.chromium||runtime.default?.chromium;if(!chromium)throw Error("The selected existing runtime has no Chromium connector.");
  browser=await chromium.connectOverCDP(args.cdp,{timeout:20000,noDefaults:true});
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:width===390?844:1080},acceptDownloads:true,serviceWorkers:"block"});owned.add(context);
   await context.route("**/*",async route=>{const req=route.request(),url=new URL(req.url()),body=url.origin===origin&&!url.search?routes.get(url.pathname):undefined;
    if(body!==undefined&&req.isNavigationRequest()&&req.method()==="GET")await route.fulfill({status:200,contentType:"text/html; charset=utf-8",body,headers:{"cache-control":"no-store"}});
    else{if(!url.pathname.endsWith("/favicon.ico"))result.browser_errors.push("Unexpected resource: "+url.origin+url.pathname);await route.abort();}
   });
   const page=await context.newPage();page.on("pageerror",e=>result.browser_errors.push(e.message));await page.goto(origin+"/");await page.locator("#downloads section").nth(1).waitFor();
   event("complete_package_view_opened",{width});
   async function capture(p,name){
    const layout=await p.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
    if(layout.documentWidth>layout.width+1)throw Error("Customer page overflows at "+width+": "+name);
    const file=width+"-"+name+".jpg";await p.screenshot({path:path.join(out,"screens",file),type:"jpeg",quality:86,fullPage:true});result.views.push({width,name,file,...layout});save();
   }
   await capture(page,"complete-packages");
   async function download(control,filename,expected){
    const pending=page.waitForEvent("download");await control.click();const d=await pending,destination=path.join(out,"downloads",width+"-"+filename);await d.saveAs(destination);
    const b=fs.readFileSync(destination);if(b.length!==expected.bytes||hash(b)!==expected.sha256)throw Error("Original download differs: "+filename);
    result.downloads.push({width,name:filename,bytes:b.length,sha256:hash(b)});save();return b;
   }
   for(const [i,p]of packages.entries()){
    const section=page.locator("#downloads section").nth(i);
    const zip=await download(section.getByRole("button",{name:"Download complete pack",exact:true}),p.name,p);
    const members=Zip.readStoredZip(new Uint8Array(zip));
    if(members.length!==p.files.length)throw Error("The complete downloaded archive selection differs.");
    for(const f of p.files){
     await section.locator("select").selectOption(f.name);await section.getByRole("button",{name:"Open document",exact:true}).click();
     await page.waitForFunction(({name})=>document.getElementById("status").textContent.startsWith("Opened "+name+"."),{name:f.name});
     const member=members.find(m=>m.name===f.name);if(!member||member.bytes!==f.bytes||hash(member.data)!==f.sha256)throw Error("Downloaded original member differs.");
     const expectedPreview=documentPreview(f.name,Zip.utf8Text(member.data));
     if(await page.locator("#preview").getAttribute("srcdoc")!==expectedPreview)throw Error("The actual selected document preview differs.");
     if(f.name.endsWith("-commissioning.html")){
      const frame=page.frameLocator("#preview"),body=frame.locator('body[data-ventcrm-opening="complete"]');
      await body.waitFor({state:"visible"});
      await frame.getByRole("heading",{name:"Open the working desk",exact:true}).waitFor({state:"visible"});
      const working=f.name.replace(/-commissioning\.html$/,"-working.json");
      await frame.locator("code").filter({hasText:working}).waitFor({state:"visible"});
      const expectedSeed=JSON.parse(Zip.utf8Text(member.data).match(/<script id="programme-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).seed;
      if(await frame.locator("body > ul > li").count()!==expectedSeed.operators.length)throw Error("The original operator selection differs in the embedded preview.");
      await frame.locator("summary").click();
      if(await frame.locator("details[open] > ol > li").count()!==expectedSeed.criteria.length)throw Error("The complete original commissioning steps are not open.");
      const frameLayout=await body.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
      if(frameLayout.documentWidth>frameLayout.width+1)throw Error("The embedded commissioning preview overflows at "+width);
      const embedded=width+"-"+i+"-commissioning-embedded.jpg";
      await page.locator("#preview").screenshot({path:path.join(out,"screens",embedded),type:"jpeg",quality:86});
      result.views.push({width,name:i+"-commissioning-embedded",file:embedded,...frameLayout,operators:expectedSeed.operators.length,steps:expectedSeed.criteria.length});
      await capture(page,i+"-commissioning-open");save();
     }
     await download(section.getByRole("button",{name:"Download document",exact:true}),i+"-"+f.name,f);
     const documentPage=await context.newPage();documentPage.on("pageerror",e=>result.browser_errors.push(e.message));
     await documentPage.goto(origin+"/documents/"+i+"/"+encodeURIComponent(f.name));await documentPage.locator("body").waitFor();
     await capture(documentPage,i+"-"+f.name.replace(/[^A-Za-z0-9_.-]/g,"_"));await documentPage.close();
     await page.locator("#close-preview").click();await page.locator("#document-preview").waitFor({state:"hidden"});
    }
   }
   await page.reload();await page.locator("#downloads section").nth(1).waitFor();event("complete_packages_reopened",{width});
   await context.close();owned.delete(context);
  }
  if(result.browser_errors.length)throw Error(result.browser_errors.join("\n"));
  result.status="PASS";event("complete_package_course_finished",{views:result.views.length,downloads:result.downloads.length});
 }catch(error){result.status="FAILED";result.error={message:error.message,stack:error.stack};save();throw error;}
 finally{
  for(const context of owned){try{await context.close();}catch(error){result.status="FAILED";(result.cleanup_errors??=[]).push(error.message);}}
  event("owned_browser_contexts_closed",{attached_browser_preserved:true});
 }
 return result;
}
run().then(r=>{console.log(JSON.stringify({status:r.status,views:r.views.length,downloads:r.downloads.length}));process.exit(r.status==="PASS"?0:1);}).catch(e=>{console.error(e.stack);process.exit(1);});
// Explicit CLI exit detaches the transport after closing only this operation's private contexts.
