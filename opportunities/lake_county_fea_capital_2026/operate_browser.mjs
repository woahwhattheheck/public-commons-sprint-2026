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
      await page.screenshot({path,fullPage:false});
      const bytes=await readFile(path);
      result.screens.push({kind,section:tab,title,path,bytes:bytes.length,sha256:sha(bytes),scope:"visible_viewport",...dimensions});
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

  // These are actual receiving actions in this temporary browser and in the
  // independently received workspace. Frozen original downloads are retained
  // first; the resulting later receiving revision is recorded separately.
  async function retainedBytes(kind,name,bytes){
    const path=join(attempt,name);
    await writeFile(path,bytes,{mode:0o600,flag:"wx"});
    const receipt={kind,path,bytes:bytes.length,sha256:sha(bytes)};
    result.downloads.push(receipt);return receipt;
  }
  async function savedBrowser(){
    return page.evaluate(id=>new Promise((resolve,reject)=>{
      const opening=indexedDB.open("lake-county-capital-program-v1",1);
      opening.onerror=()=>reject(opening.error);
      opening.onsuccess=()=>{
        const db=opening.result,tx=db.transaction("workspaces"),request=tx.objectStore("workspaces").get(id);
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
        tx.oncomplete=()=>db.close();tx.onabort=()=>db.close();
      };
    }),startup.workspace_id);
  }
  async function untilSaved(check,message){
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      const current=await savedBrowser();
      if(check(current))return current;
      await page.waitForTimeout(50);
    }
    throw new Error(message);
  }
  async function downloadedDraft(button,kind,name){
    const waiting=page.waitForEvent("download");
    await page.locator(button).click();
    const download=await waiting,path=join(attempt,name);
    await download.saveAs(path);
    const bytes=await readFile(path),value=JSON.parse(bytes);
    if(value.schema!=="lake-county.browser-backup/v1"||value.workspace_id!==startup.workspace_id
       ||value.browser_state?.workspaceId!==startup.workspace_id)throw new Error("The actual draft backup belongs to another workspace.");
    const receipt={kind,path,bytes:bytes.length,sha256:sha(bytes)};
    result.downloads.push(receipt);return {receipt,value};
  }
  const localRead=async route=>{
    const response=await context.request.get(startup.origin+route,{headers:{Authorization:"Bearer "+startup.token}});
    if(!response.ok())throw new Error("The received native read failed: "+route+" HTTP"+response.status());
    return response;
  };
  result.operator_journey={schema:"lake-county.browser-operator-receiving/v1",complete:false,
    scope:"Actual original received application and existing public source bytes; no client asset, model, funding or approval is invented.",
    started_at:new Date().toISOString()};
  const priorStatus=await (await localRead("/api/status")).json();
  result.operator_journey.original_received_revision=priorStatus.revision;
  await page.locator('#navigation button[data-tab="sources"]').click();
  const note=page.locator('[data-draft="upload"][data-field="note"]');
  await note.waitFor({state:"visible"});
  const firstNote="Internal receiving draft: preserve the source authority and exact original public file.";
  const laterNote="Internal later draft retained before reopening the selected backup.";
  const recoveredNote="Internal receiving draft recovered after an explicitly induced browser transaction abort.";
  await note.fill(firstNote);
  await untilSaved(x=>x?.drafts?.upload?.values?.note===firstNote,"The initial real browser draft did not save.");
  const firstBackup=await downloadedDraft("#download-browser-backup","browser_draft_original","Draft_Backup_Original.json");
  await note.fill(laterNote);
  await untilSaved(x=>x?.drafts?.upload?.values?.note===laterNote,"The later real browser draft did not save.");
  const chooser=page.waitForEvent("filechooser");
  await page.locator("#open-browser-backup").click();
  const selectedChooser=await chooser;
  const originalBackupBytes=await readFile(firstBackup.receipt.path);
  if(sha(originalBackupBytes)!==firstBackup.receipt.sha256)throw new Error("The selected original draft backup changed.");
  await selectedChooser.setFiles({name:"Draft_Backup_Original.json",mimeType:"application/json",buffer:originalBackupBytes});
  await page.locator("#restore-browser-backup").waitFor({state:"visible"});
  const currentDownload=page.waitForEvent("download");
  await page.locator("#restore-browser-backup").click();
  const beforeRestore=await currentDownload,beforeRestorePath=join(attempt,"Draft_Before_Restore.json");
  await beforeRestore.saveAs(beforeRestorePath);
  const beforeRestoreBytes=await readFile(beforeRestorePath),beforeRestoreValue=JSON.parse(beforeRestoreBytes);
  if(beforeRestoreValue.workspace_id!==startup.workspace_id||beforeRestoreValue.browser_state?.drafts?.upload?.values?.note!==laterNote)
    throw new Error("The existing later draft was not downloaded before restore.");
  result.downloads.push({kind:"browser_draft_before_restore",path:beforeRestorePath,bytes:beforeRestoreBytes.length,sha256:sha(beforeRestoreBytes)});
  await untilSaved(x=>x?.drafts?.upload?.values?.note===firstNote,"The original workspace-bound draft backup did not reopen.");
  result.operator_journey.draft_backup_restore={complete:true,selected:firstBackup.receipt,preserved_later_draft:beforeRestorePath,
    restored_note:firstNote,preserved_note:laterNote};

  // Abort one real IndexedDB transaction. The hook restores itself immediately;
  // it supplies a labelled failure exercise, not an observed customer outage.
  await page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    window.__feaReceivingAbort={armed:true,aborted:0};
    IDBObjectStore.prototype.put=function(...args){
      const request=original.apply(this,args);
      if(window.__feaReceivingAbort.armed&&this.name==="workspaces"
         &&this.transaction.db.name==="lake-county-capital-program-v1"){
        IDBObjectStore.prototype.put=original;
        window.__feaReceivingAbort.armed=false;
        window.__feaReceivingAbort.aborted++;
        this.transaction.abort();
      }
      return request;
    };
  });
  await note.evaluate((element,value)=>{element.value=value;element.dispatchEvent(new Event("input",{bubbles:true}));},recoveredNote);
  await page.locator("#browser-recovery").waitFor({state:"visible"});
  const abort=await page.evaluate(()=>window.__feaReceivingAbort);
  if(abort.aborted!==1||(await savedBrowser())?.drafts?.upload?.values?.note!==firstNote)
    throw new Error("The bounded original IndexedDB abort did not preserve the preceding saved draft.");
  const unsaved=await downloadedDraft("#download-unsaved-backup","browser_unsaved_draft","Draft_Unsaved_After_Abort.json");
  if(unsaved.value.browser_state?.drafts?.upload?.values?.note!==recoveredNote)
    throw new Error("The current unsaved draft could not be downloaded after the real abort.");
  await page.locator("#retry-browser-save").click();
  await page.locator("#browser-recovery").waitFor({state:"hidden"});
  await untilSaved(x=>x?.drafts?.upload?.values?.note===recoveredNote,"The original retry did not retain the current draft.");
  await page.reload({waitUntil:"domcontentloaded"});
  await page.locator("#main h1").waitFor({state:"visible"});
  await page.locator('#navigation button[data-tab="sources"]').click();
  if(await note.inputValue()!==recoveredNote)throw new Error("The saved recovery draft did not survive the actual browser reload.");
  const beforeUploadStatus=await (await localRead("/api/status")).json();
  if(beforeUploadStatus.revision!==priorStatus.revision)throw new Error("Browser draft recovery unexpectedly changed the native workspace.");
  result.operator_journey.storage_failure_recovery={complete:true,kind:"explicit_internal_single_native_transaction_abort",
    actual_aborted_transactions:abort.aborted,preceding_saved_note:firstNote,recovered_note:recoveredNote,
    unsaved_backup:unsaved.receipt,reloaded:true,native_revision_unchanged:true};

  const originalFile=beforeUploadStatus.files.filter(file=>
    file.metadata?.source_kind==="public_original"&&(String(file.mime).includes("pdf")||/\.pdf$/i.test(file.name)))
    .sort((a,b)=>b.bytes-a.bytes)[0];
  if(!originalFile)throw new Error("The actual captured public sources contain no original PDF for the receiving upload.");
  const originalBytes=await (await localRead("/api/file?"+new URLSearchParams({id:originalFile.id}))).body();
  if(originalBytes.length!==originalFile.bytes||sha(originalBytes)!==originalFile.sha256)
    throw new Error("The selected original public PDF changed before the actual receiving upload.");
  const inputReceipt=await retainedBytes("browser_original_upload_input","Original_UI_Upload.pdf",originalBytes);
  await page.locator('[data-draft="upload"][data-field="authority"]').fill(originalFile.metadata.authority);
  await page.locator('[data-draft="upload"][data-field="source_kind"]').selectOption("public_original");
  await page.locator('[data-draft="upload"][data-field="url"]').fill(originalFile.metadata.url||originalFile.metadata.source_url||"");
  await note.fill("Internal receiving check: re-retain these exact already captured public bytes. No new source edition or client approval is created.");
  await page.locator("#source-upload").setInputFiles({name:originalFile.name,mimeType:String(originalFile.mime).split(";")[0],buffer:originalBytes});
  const acknowledged=page.waitForResponse(response=>response.url()===startup.origin+"/api/action"
    &&response.request().method()==="POST");
  await page.locator("#retain-file").click();
  const acknowledgedResponse=await acknowledged;
  const response=await acknowledgedResponse.json();
  if(!acknowledgedResponse.ok()||response.workspace_id!==startup.workspace_id
     ||response.result?.sha256!==originalFile.sha256||response.result?.bytes!==originalFile.bytes)
    throw new Error("The actual original-source upload did not retain the selected complete bytes.");
  await untilSaved(state=>!!state&&!state.pending&&state.completed.some(entry=>entry.request_reference?.operation_id===response.operation_id),
    "The acknowledged upload did not become a compact browser journal record.");
  const afterUploadBackup=await downloadedDraft("#download-browser-backup","browser_compacted_upload","Draft_After_Acknowledged_Upload.json");
  const compact=afterUploadBackup.value.browser_state.completed.find(entry=>entry.request_reference?.operation_id===response.operation_id);
  if(!compact||Object.hasOwn(compact,"request")||compact.request_reference.request_sha256!==response.request_sha256
     ||compact.request_reference.file.id!==response.result.id||compact.request_reference.file.sha256!==originalFile.sha256
     ||compact.request_reference.file.bytes!==originalFile.bytes)
    throw new Error("The browser backup did not preserve the exact compact acknowledged file request.");
  const originalOperation=await (await localRead("/api/operation?"+new URLSearchParams({id:response.operation_id}))).json();
  const payload=originalOperation.request?.payload,originalRequestBytes=Buffer.from(payload?.base64||"","base64");
  if(originalOperation.status!=="complete"||originalOperation.request_sha256!==response.request_sha256
     ||originalOperation.request.action!=="file.retain"||originalRequestBytes.length!==originalFile.bytes
     ||sha(originalRequestBytes)!==originalFile.sha256||payload.sha256!==originalFile.sha256)
    throw new Error("The native operation did not retain the full original request after browser compaction.");
  const nativeRequestReceipt=await retainedBytes("native_original_request","Native_UI_Original_Request.json",
    Buffer.from(JSON.stringify(originalOperation,null,2)+"\n"));
  const afterStatus=await (await localRead("/api/status")).json();
  if(afterStatus.context.workspace_id!==startup.workspace_id||afterStatus.revision===priorStatus.revision
     ||!afterStatus.files.some(file=>file.id===response.result.id&&file.sha256===originalFile.sha256))
    throw new Error("The actual receiving file did not remain in the original native workspace.");
  result.operator_journey.acknowledged_upload={complete:true,original_file:{id:originalFile.id,name:originalFile.name,bytes:originalFile.bytes,sha256:originalFile.sha256},
    input:inputReceipt,operation_id:response.operation_id,request_sha256:response.request_sha256,
    retained_file:compact.request_reference.file,compact_record_bytes:Buffer.byteLength(JSON.stringify(compact)),
    full_native_request:nativeRequestReceipt,browser_backup:afterUploadBackup.receipt};
  result.operator_journey.later_received_revision=afterStatus.revision;
  result.operator_journey.complete=true;
  result.operator_journey.completed_at=new Date().toISOString();

  result.complete=result.page_errors.length===0&&result.overflow.length===0&&result.operator_journey.complete;
}catch(error){
  result.error=error.message;
}finally{
  if(browser)await browser.close();
  result.completed_at=new Date().toISOString();
  await writeFile(join(attempt,"review.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});
}
process.stdout.write(JSON.stringify(result)+"\n");
if(!result.complete)process.exitCode=2;
