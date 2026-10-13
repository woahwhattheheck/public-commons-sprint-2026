import {promises as fs} from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import crypto from "node:crypto";

const check=(value,message)=>{if(!value)throw new Error(message);};
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const stable=value=>value===null||typeof value!=="object"?JSON.stringify(value):Array.isArray(value)?"["+value.map(stable).join(",")+"]":"{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";
const keys={client:["AGNCY","CLIENTID","NDTMS_CONSENT_SCOPE"],episode:["AGNCY","CLIENTID","EPISODID"],intervention:["AGNCY","CLIENTID","EPISODID","MODID"],sir:["AGNCY","CLIENTID","EPISODID","SUBMID"],top_ypor:["AGNCY","CLIENTID","EPISODID","TOPID"],cir:["AGNCY","CLIENTID","EPISODID","CIRID"]};


/** Restore a complete portable input in this invocation's fresh browser context. */
async function reopenInputDraft({page,root,input,workspaceId,journal,save,fileReceipt,label}) {
  const actual=await fileReceipt(input.path);
  check(actual.bytes===input.bytes&&actual.sha256===input.sha256,"The original complete portable input changed.");
  const incoming=JSON.parse(await fs.readFile(input.path,"utf8"));
  check(incoming.workspaceId===workspaceId,"The input belongs to another workspace.");
  const key="ndtms-input-reopen-"+label,history=journal.evidence[key]||[];
  check(Array.isArray(history),"The retained input recovery history is invalid.");
  for(const retained of journal.evidence[key+"-interrupted"]||[]){
    const stat=await fs.lstat(retained.path),observed=await fileReceipt(retained.path);
    check(stat.isFile()&&!stat.isSymbolicLink()&&observed.bytes===retained.bytes&&observed.sha256===retained.sha256&&retained.originalInputSha256===input.sha256,"The original interrupted input-recovery bytes changed.");
  }
  for(const retained of history){
    const stat=await fs.lstat(retained.path);
    check(stat.isFile()&&!stat.isSymbolicLink(),"The original input-recovery file is not ordinary.");
    const observed=await fileReceipt(retained.path);
    check(observed.bytes===retained.bytes&&observed.sha256===retained.sha256,"The original input-recovery bytes changed.");
    const value=JSON.parse(await fs.readFile(retained.path,"utf8"));
    check(value.workspaceId===workspaceId&&stable(value.incoming)===stable(incoming),"A retained input recovery has another source.");
  }
  await page.locator("#ndtms-portable-draft").setInputFiles(input.path);
  page.once("dialog",dialog=>dialog.accept());
  const waiting=page.waitForEvent("download");
  await page.getByRole("button",{name:"Open selected input draft",exact:true}).click();
  const received=await waiting,temp=path.join(root,label+".receiving");
  const oldTemp=await fs.lstat(temp).catch(e=>{if(e.code==="ENOENT")return null;throw e;});
  check(!oldTemp||oldTemp.isFile()&&!oldTemp.isSymbolicLink(),"The input-recovery staging path is not ordinary.");
  // A complete interrupted download is preserved by content identity before the next one is written.
  if(oldTemp){
    const oldBytes=await fs.readFile(temp);let oldValue,parseFailure=null;
    try{oldValue=JSON.parse(oldBytes.toString("utf8"));}catch(error){parseFailure=error.message;}
    if(!parseFailure)check(oldValue?.workspaceId===workspaceId&&stable(oldValue.incoming)===stable(incoming),"Preserve the staging file from another input operation.");
    const oldPath=path.join(root,label+"-"+hash(oldBytes)+(parseFailure?".interrupted.bin":".json"));
    const oldFinal=await fs.lstat(oldPath).catch(e=>{if(e.code==="ENOENT")return null;throw e;});
    if(oldFinal){check(oldFinal.isFile()&&!oldFinal.isSymbolicLink()&&(await fs.readFile(oldPath)).equals(oldBytes),"The retained staging recovery differs.");await fs.unlink(temp);}
    else await fs.rename(temp,oldPath);
    const oldReceipt=await fileReceipt(oldPath);
    if(parseFailure){
      const interruptedKey=key+"-interrupted",interrupted=journal.evidence[interruptedKey]||[];
      check(Array.isArray(interrupted),"The interrupted input-recovery history is invalid.");
      if(!interrupted.some(x=>x.path===oldReceipt.path))interrupted.push({...oldReceipt,state:"INTERRUPTED_DOWNLOAD",parseFailure,originalInputSha256:input.sha256});
      journal.evidence[interruptedKey]=interrupted;
    }else if(!history.some(x=>x.path===oldReceipt.path))history.push(oldReceipt);
    journal.evidence[key]=history;await save();
  }
  await received.saveAs(temp);
  const bytes=await fs.readFile(temp),value=JSON.parse(bytes.toString("utf8"));
  check(value.workspaceId===workspaceId&&stable(value.incoming)===stable(incoming),"The reopened input differs from the frozen original.");
  const file=path.join(root,label+"-"+hash(bytes)+".json");
  const old=await fs.lstat(file).catch(e=>{if(e.code==="ENOENT")return null;throw e;});
  if(old){check(old.isFile()&&!old.isSymbolicLink()&&(await fs.readFile(file)).equals(bytes),"The complete existing input recovery differs.");await fs.unlink(temp);}
  else await fs.rename(temp,file);
  const receipt=await fileReceipt(file);
  if(!history.some(x=>x.path===receipt.path))history.push(receipt);
  journal.evidence[key]=history;await save();
  await page.waitForFunction(()=>document.querySelector("#ndtms-draft-status")?.textContent==="Input draft saved in this browser.");
  return receipt;
}

/** Runs inside the original native/browser.mjs owner. Never launches/closes its browser. */
export async function runNdtmsBrowserCourse({page,context,outputDirectory,nativeResult,sessionUrl,attachments=[],runtime}) {
  const {api,open,ready,shot,originalUIAction,backupAndReceive,journal,save,fileReceipt,stop}=runtime;
  for(const name of ["api","open","ready","shot","originalUIAction","backupAndReceive","save","fileReceipt","stop"])
    check(typeof runtime[name]==="function","Use the original native browser helper: "+name);
  check(nativeResult?.schema==="nelc.ndtms-native-result/v1"&&nativeResult.state==="CORE_COMPLETE","Select the completed original native course.");
  const root=path.resolve(outputDirectory);
  const source=nativeResult.artifacts.find(x=>path.basename(x.path)==="Authored_Original_290.csv");
  check(source,"The original complete authored CSV is required.");
  const actualSource=await fileReceipt(source.path);
  check(actualSource.bytes===source.bytes&&actualSource.sha256===source.sha256,"The original authored input bytes changed.");
  const initial=await api("/api/overview");
  check(initial.workspace.id===nativeResult.sourceWorkspaceId,"The browser opened another native source workspace.");
  const profile=await api("/api/ndtms-profile");
  check(profile.fields.length===290&&new Set(profile.fields.map(f=>f.header)).size===290,"The actual complete published catalogue is missing.");
  const catalogueHeaders=profile.fields.map(f=>f.header);
  const cmsColumn=catalogueHeaders.indexOf("CMSID");
  check(cmsColumn>=0,"The current profile lacks the original CMSID header.");
  journal.evidence.ndtmsSource={...source,profileId:profile.id,workspaceId:initial.workspace.id};
  await save();

  const panel=heading=>page.locator("section.panel").filter({has:page.getByRole("heading",{name:heading,exact:true})});
  async function expand(summary,within=page) {
    const details=within.locator("details").filter({has:within.locator("summary").filter({hasText:summary})}).first();
    check(await details.count()===1,"The actual disclosure is missing: "+summary);
    if(await details.getAttribute("open")===null)await details.locator("summary").first().click();
    return details;
  }
  async function choose(label,value,view="ndtms",within=page) {
    const before=Number(await page.locator("#main").getAttribute("data-generation"));
    await within.getByLabel(label,{exact:true}).selectOption(value);
    await ready(view,before);
  }
  async function closeDialog() {
    if(await page.locator("#record-dialog").isVisible())await page.locator("#record-dialog [data-close-dialog]").click();
  }
  async function download(name,action,validate,owner=page) {
    const evidenceKey="ndtms-file-"+name,file=path.join(root,name);
    if(journal.evidence[evidenceKey]){
      const actual=await fileReceipt(file),previous=journal.evidence[evidenceKey];
      check(actual.sha256===previous.sha256&&actual.bytes===previous.bytes,"The original downloaded file changed: "+name);
      return previous;
    }
    stop();const waiting=owner.waitForEvent("download");
    await action();const received=await waiting,temp=file+".receiving";
    const previous=await fs.lstat(temp).catch(e=>{if(e.code==="ENOENT")return null;throw e;});
    check(!previous||previous.isFile()&&!previous.isSymbolicLink(),"The receiving staging path is not an ordinary file.");
    await received.saveAs(temp);const bytes=await fs.readFile(temp);await validate(bytes);
    const existing=await fs.lstat(file).catch(e=>{if(e.code==="ENOENT")return null;throw e;});
    if(existing){
      check(existing.isFile()&&!existing.isSymbolicLink(),"The original output is not ordinary.");
      check(hash(await fs.readFile(file))===hash(bytes),"Preserve a differing original output: "+name);await fs.unlink(temp);
    }else await fs.rename(temp,file);
    const receipt=await fileReceipt(file);journal.evidence[evidenceKey]=receipt;await save();return receipt;
  }
  async function viewArtifact(receipt,name,{print=false}={}) {
    const original=await fileReceipt(receipt.path);
    check(original.sha256===receipt.sha256&&original.bytes===receipt.bytes,"An exact view input changed.");
    const child=await context.newPage();
    const errors=[];child.on("pageerror",e=>errors.push(e.message));
    try{
      await child.goto(pathToFileURL(receipt.path).href,{waitUntil:"load"});
      check(await child.locator("body").innerText(),"The exact output has no readable content.");
      for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
        await child.setViewportSize(viewport);
        const dimensions=await child.evaluate(()=>({body:document.documentElement.scrollWidth,viewport:innerWidth}));
        check(dimensions.body<=dimensions.viewport+2,"The exact output overflows the viewport: "+name);
        const label=name+"-"+viewport.width,file=path.join(root,label+".png");
        if(!journal.screenshots.some(x=>x.name===label)){
          await child.screenshot({path:file,fullPage:true});
          journal.screenshots.push({name:label,...await fileReceipt(file)});await save();
        }
      }
      if(print){
        await child.emulateMedia({media:"print"});await child.setViewportSize({width:1440,height:1000});
        const label=name+"-print",file=path.join(root,label+".png");
        if(!journal.screenshots.some(x=>x.name===label)){
          await child.screenshot({path:file,fullPage:true});journal.screenshots.push({name:label,...await fileReceipt(file)});await save();
        }
      }
      check(errors.length===0,"The exact output raised a browser error: "+errors.join("; "));
    }finally{await child.close();}
  }

  await open("ndtms");
  await expand("Complete published field catalogue");
  await download("Published_NDTMS_Catalogue.json",()=>page.getByRole("button",{name:"Download full catalogue",exact:true}).click(),bytes=>{
    check(stable(JSON.parse(bytes.toString("utf8")))===stable(profile),"The complete downloaded catalogue differs from the installed profile.");
  });
  await download("Published_NDTMS_Blank_290.csv",()=>page.getByRole("button",{name:"Download blank 290-column CSV",exact:true}).click(),bytes=>{
    check(bytes.equals(Buffer.from(catalogueHeaders.join(",")+"\r\n","utf8")),"The blank original-order headers differ.");
  });
  const catalogueForm=page.locator("form").filter({has:page.getByRole("button",{name:"Filter fields",exact:true})});
  await catalogueForm.getByLabel("Find header, layout or rule",{exact:true}).fill("CMSID");
  {const generation=Number(await page.locator("#main").getAttribute("data-generation"));await catalogueForm.getByRole("button",{name:"Filter fields",exact:true}).click();await ready("ndtms",generation);}
  await expand("Complete published field catalogue");await shot("ndtms-complete-catalogue-filter");

  const importedOperation=await originalUIAction("ndtms-browser-import",async()=>{
    await open("sources");const detail=await expand("Import a complete source edition");
    await detail.getByLabel("Edition name",{exact:true}).fill("Authored NDTMS browser receiving — no real people");
    await detail.locator('input[name="file"]').setInputFiles(source.path);
    await detail.getByLabel("Original source or supplied export reference",{exact:true}).fill("Original authored native receiving fixture; SHA256 "+source.sha256);
    await detail.getByLabel("Source notes",{exact:true}).fill("Eight fictional structural receiving records. Separate browser continuation of the original programme; no real person or supplier acceptance.");
    await detail.getByRole("button",{name:"Retain original & import edition",exact:true}).click();
  });
  const edition=importedOperation.result;
  check(edition?.tables?.length===1&&edition.rows===8&&edition.original.sha256===source.sha256,"The browser did not retain the complete eight-row original.");
  const table=edition.tables[0];
  async function configureAnalysis() {
    await open("ndtms");await expand("Analyse an original source selection");
    const form=page.locator("#ndtms-analysis-form");
    await choose("Original source edition",edition.id,"ndtms",form);
    await expand("Analyse an original source selection");
    const active=page.locator("#ndtms-analysis-form");
    await active.getByLabel("Original 290-column CSV table",{exact:true}).selectOption(table.id);
    await active.getByLabel("Declared cohort",{exact:true}).selectOption("mixed");
    await active.getByLabel("Extract scope",{exact:true}).selectOption("full");
    await active.getByLabel("Exact agency code (blank for the declared multi-agency population)",{exact:true}).fill("EX001");
    await active.getByLabel("Declared extraction from date",{exact:true}).fill("");
    await active.getByLabel("Declared extraction to date",{exact:true}).fill("");
    await active.locator('textarea[name="scope_note"]').fill("Complete fictional eight-record structural receiving population, explicitly authored. Published clinical cohort applicability is not evaluated.");
    return active;
  }
  const blockedOperation=await originalUIAction("ndtms-browser-conflicted-analysis",async()=>{
    const form=await configureAnalysis();await form.getByRole("button",{name:"Analyse this retained source",exact:true}).click();
  });
  const blocked=blockedOperation.result;
  check(!blocked.ready&&blocked.counts.conflictedEntities===1,"The original repeated episode conflict was not retained.");
  await open("ndtms");await choose("Retained analysis",blocked.id);
  await shot("ndtms-original-conflict-and-source");
  const correctedOperation=await originalUIAction("ndtms-browser-correct-source",async()=>{
    await open("ndtms");await choose("Retained analysis",blocked.id);
    const finding=panel("Every source finding").locator("tr").filter({hasText:"REPEATED_ENTITY_CONFLICT"}).first();
    await finding.getByRole("button",{name:"Record 7",exact:true}).click();
    const dialog=page.locator("#record-dialog");
    await dialog.getByLabel("Cell to correct",{exact:true}).selectOption(String(cmsColumn));
    await dialog.locator('input[name="to"]').fill("authored-original");
    await dialog.getByLabel("Evidence reference or locator",{exact:true}).fill("Original authored fixture "+source.sha256+"; repeated episode record7");
    await dialog.getByLabel("Correction reason",{exact:true}).fill("The labelled authored receiving example identifies this single divergent CMSID; retain its original string and this reviewed successor.");
    await dialog.getByRole("button",{name:"Retain reviewed correction",exact:true}).click();
  });
  check(correctedOperation.result?.from==="authored-conflict"&&correctedOperation.result?.to==="authored-original","The original source correction did not bind both exact values.");
  const readyOperation=await originalUIAction("ndtms-browser-corrected-analysis",async()=>{
    const form=await configureAnalysis();await form.getByRole("button",{name:"Analyse this retained source",exact:true}).click();
  });
  const analysis=readyOperation.result;
  check(analysis.ready&&analysis.counts.nativeClients===2&&analysis.counts.clientPartitionRows===3&&analysis.counts.entities.episode===3,
    "The corrected native identities or consent-separated parents differ.");
  await open("ndtms");await choose("Retained analysis",analysis.id);await shot("ndtms-corrected-population");
  const sourceRows=await api("/api/page?"+new URLSearchParams({kind:"ndtms-rows",selection:JSON.stringify({analysisId:analysis.id,entity:"client"}),limit:"200"}));
  check(sourceRows.items.length===3,"The actual client projection has another population.");
  const minimal=sourceRows.items.find(x=>x.consentScope==="N");
  check(minimal&&Object.entries(minimal.values).every(([k,v])=>["AGNCY","CLIENTID","NDTMS_CONSENT_SCOPE"].includes(k)||v===""),"The minimal no-consent client inherited protected values.");
  const clientRows=panel("Projected entities and complete lineage").locator("tbody tr");
  const index=sourceRows.items.findIndex(x=>x.id===minimal.id);
  await clientRows.nth(index).getByRole("button",{name:"Inspect entity & witnesses",exact:true}).click();
  await shot("ndtms-no-consent-original-lineage");await closeDialog();
  const reportRef=analysis.artifacts.report;
  const report=await download("Browser_NDTMS_Complete_Analysis.html",()=>panel("Original analysis selection").getByRole("button",{name:reportRef.name,exact:true}).click(),bytes=>{
    check(bytes.length===reportRef.bytes&&hash(bytes)===reportRef.sha256,"The complete analysis report differs from its original artifact.");
  });
  await viewArtifact(report,"ndtms-analysis-report",{print:true});

  const publicationOperation=await originalUIAction("ndtms-browser-publish-six",async()=>{
    await open("ndtms");await choose("Retained analysis",analysis.id);
    await page.getByRole("button",{name:"Publish complete six-entity source",exact:true}).click();
  });
  const normalized=publicationOperation.result.edition;
  check(normalized?.tables?.length===6&&normalized.rows===10,"The complete published source must contain six tables and ten normalized rows.");
  // beginContract has opened the original explicit editor after successful publication.
  // On replay reopen the same original header editor through its ordinary source chooser.
  const mappingOperation=await originalUIAction("ndtms-browser-explicit-mapping",async()=>{
    await open("contracts");
    if(!(await page.locator("#contract-editor").count())){
      await page.locator("#contract-source-choice").getByLabel("Original source edition",{exact:true}).selectOption(normalized.id);
      await page.locator("#contract-source-choice").getByRole("button",{name:"Build from actual headers",exact:true}).click();
      await page.locator("#contract-editor").waitFor();
    }
    const editor=page.locator("#contract-editor");
    await editor.getByLabel("Contract name",{exact:true}).fill("Authored browser six-entity receiving contract");
    await editor.getByLabel("Supplied specification or local receiving authority",{exact:true}).fill("Owned authored structural receiving course only; no supplier schema or clinical acceptance");
    for(let i=0;i<normalized.tables.length;i++){
      const t=normalized.tables[i],entity=path.basename(t.name,".csv"),identity=keys[entity];
      check(identity,"The normalized table is not one of the six declared entities.");
      for(const name of identity){
        const column=t.headers.indexOf(name);check(column>=0,"The normalized exact key is missing: "+name);
        await editor.locator('input[name="m'+i+'-sourceKey"][value="'+column+'"]').check();
        await editor.locator('input[name="m'+i+'-c'+column+'-key"]').check();
        await editor.locator('input[name="m'+i+'-c'+column+'-required"]').check();
      }
    }
    await editor.getByLabel("Why this contract or revision is being retained",{exact:true}).fill("Retain the explicitly owned six-table identity mapping and consent partition for this authored UI course.");
    await editor.getByLabel("Contract notes",{exact:true}).fill("The native course separately operates parent relationships, target load, returned fields, independent target changes and rollback. This browser contract preserves all current six-table fields and source/target keys.");
    await editor.getByRole("button",{name:"Retain mapping contract",exact:true}).click();
  });
  const contract=mappingOperation.result;
  check(contract.definition.editionId===normalized.id&&contract.definition.tables.length===6,"The explicit mapping has another source selection.");
  await open("contracts");await shot("ndtms-six-table-explicit-mapping");
  const approvalOperation=await originalUIAction("ndtms-browser-approve-mapping",async()=>{
    await open("contracts");await choose("Contract edition",contract.id,"contracts");
    const p=panel("Approve this exact mapping");
    await p.getByLabel("I reviewed the original source edition and exact field/key mappings",{exact:true}).check();
    await p.getByLabel("The supplied target contract or explicitly owned local receiving authority is identified",{exact:true}).check();
    await p.getByLabel("Reviewer decision and evidence",{exact:true}).fill("Exact authored local receiving authority and source keys reviewed. This is not a supplier or clinical decision.");
    await p.getByRole("button",{name:"Approve exact mapping",exact:true}).click();
  });
  check(approvalOperation.result.contractId===contract.id,"The approval selected another original contract.");
  const assessmentOperation=await originalUIAction("ndtms-browser-assess-mapping",async()=>{
    await open("contracts");await choose("Contract edition",contract.id,"contracts");
    await page.getByRole("button",{name:"Assess all mapped rows",exact:true}).click();
  });
  check(assessmentOperation.result.ready&&assessmentOperation.result.mappedRows===10,"The full browser mapping assessment did not retain all ten rows.");
  await shot("ndtms-reviewed-mapping-assessment");

  await open("ndtms");await choose("Retained analysis",analysis.id);
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),"The actual NDTMS view overflows mobile width.");
  await shot("ndtms-mobile-population");
  await page.getByRole("button",{name:"Open navigation",exact:true}).click();
  check(await page.locator(".shell.menu-open").count()===1,"The actual mobile navigation did not open.");
  await page.setViewportSize({width:1440,height:1000});
  // Preserve both tabs through actual IndexedDB revision-CAS, without a workspace mutation.
  const noteA="Authored unfinished source note A — preserve accents: café, £, 中文.";
  const noteB="Authored unfinished source note B — current writing survives a competing tab.";
  let inputDraft=journal.evidence.ndtmsPortableDraft;
  if(!inputDraft){
    if(!journal.evidence.ndtmsCompetingDrafts){
    await configureAnalysis();
    const selector='textarea[name="scope_note"]';
    await page.locator("#ndtms-analysis-form "+selector).fill("Authored initial shared input");
    await page.waitForFunction(()=>document.querySelector("#ndtms-draft-status")?.textContent==="Input draft saved in this browser.");
    const sibling=await context.newPage();
    try{
      check(typeof sessionUrl==="string"&&new URL(sessionUrl).origin===new URL(page.url()).origin,"Use the original same-listener session for the sibling draft.");
      await sibling.goto(sessionUrl,{waitUntil:"domcontentloaded"});
      await sibling.waitForFunction(()=>document.querySelector("#main")?.getAttribute("aria-busy")==="false");
      await sibling.locator('#navigation a[href="#ndtms"]').click();
      await sibling.waitForFunction(()=>document.querySelector("#main")?.dataset.view==="ndtms"&&document.querySelector("#main")?.getAttribute("aria-busy")==="false");
      const disclosure=sibling.locator("details").filter({has:sibling.locator("summary").filter({hasText:"Analyse an original source selection"})}).first();
      if(await disclosure.getAttribute("open")===null)await disclosure.locator("summary").first().click();
      await page.locator("#ndtms-analysis-form "+selector).fill(noteA);
      await page.waitForFunction(()=>document.querySelector("#ndtms-draft-status")?.textContent==="Input draft saved in this browser.");
      await sibling.locator("#ndtms-analysis-form "+selector).fill(noteB);
      await sibling.waitForFunction(()=>document.querySelector("#ndtms-draft-status")?.textContent?.includes("Another saved draft is retained."));
      const conflictReceipt=await download("NDTMS_Competing_Current_Input.json",()=>sibling.getByRole("button",{name:"Download current input draft",exact:true}).click(),bytes=>{
        const value=JSON.parse(bytes.toString("utf8"));check(value.value.scope.note===noteB,"The competing tab lost its current writing.");
      },sibling);
      const priorBoth=!!journal.evidence["ndtms-file-NDTMS_Competing_Both_Inputs.json"];
      await download("NDTMS_Competing_Both_Inputs.json",()=>{
        sibling.once("dialog",dialog=>dialog.accept());
        return sibling.getByRole("button",{name:"Download both & open saved",exact:true}).click();
      },bytes=>{
        const value=JSON.parse(bytes.toString("utf8"));
        check(value.current.scope.note===noteB&&value.saved.value.scope.note===noteA,"The recovery file does not retain both complete drafts.");
      },sibling);
      if(!priorBoth)await sibling.waitForFunction(()=>document.querySelector("#ndtms-draft-status")?.textContent==="Input draft saved in this browser.");
      journal.evidence.ndtmsCompetingDrafts={current:conflictReceipt,firstNote:noteA,secondNote:noteB};await save();
    }finally{await sibling.close();}
    }
    // Reconstruct the selected A input only from the full original two-tab recovery download.
    // This also restores its actual controls after a process restart created a fresh browser context.
    const savedBranch=journal.evidence["ndtms-file-NDTMS_Competing_Both_Inputs.json"];
    check(savedBranch,"The original complete saved branch is required for portable recovery.");
    const savedObserved=await fileReceipt(savedBranch.path);
    check(savedObserved.bytes===savedBranch.bytes&&savedObserved.sha256===savedBranch.sha256,"The original two-tab recovery changed.");
    const savedBody=JSON.parse(await fs.readFile(savedBranch.path,"utf8"));
    check(savedBody.workspaceId===nativeResult.sourceWorkspaceId&&savedBody.saved.value.scope.note===noteA,"The saved input branch has another original selection.");
    const branchBytes=Buffer.from(JSON.stringify({workspaceId:savedBody.workspaceId,value:savedBody.saved.value},null,2)+"\n");
    const branchPath=path.join(root,"NDTMS_Saved_Input_Branch-"+hash(branchBytes)+".json");
    const branchOld=await fs.lstat(branchPath).catch(e=>{if(e.code==="ENOENT")return null;throw e;});
    if(branchOld)check(branchOld.isFile()&&!branchOld.isSymbolicLink()&&(await fs.readFile(branchPath)).equals(branchBytes),"The complete original saved input branch differs.");
    else{
      const pending=branchPath+".receiving",pendingOld=await fs.lstat(pending).catch(e=>{if(e.code==="ENOENT")return null;throw e;});
      check(!pendingOld||pendingOld.isFile()&&!pendingOld.isSymbolicLink(),"The owned input branch staging is not ordinary.");
      await fs.writeFile(pending,branchBytes,{mode:0o600});await fs.rename(pending,branchPath);
    }
    const selectedBranch=await fileReceipt(branchPath);journal.evidence.ndtmsSelectedInputBranch=selectedBranch;await save();
    await reopenInputDraft({page,root,input:selectedBranch,workspaceId:nativeResult.sourceWorkspaceId,journal,save,fileReceipt,label:"Source_Saved_Branch_Reopened"});
    // The other complete B branch remains in its explicit recovery file.
    await page.reload({waitUntil:"domcontentloaded"});await ready("ndtms");await expand("Analyse an original source selection");
    check(await page.locator('#ndtms-analysis-form textarea[name="scope_note"]').inputValue()===noteA,"Cold browser reopening lost the saved current draft.");
    inputDraft=await download("NDTMS_Current_Input_Draft.json",()=>page.getByRole("button",{name:"Download current input draft",exact:true}).click(),bytes=>{
      const value=JSON.parse(bytes.toString("utf8"));check(value.workspaceId===nativeResult.sourceWorkspaceId&&value.value.scope.note===noteA,"The whole portable draft differs.");
    });
    await page.locator("#ndtms-portable-draft").setInputFiles(inputDraft.path);
    await download("NDTMS_Input_Reopen_Recovery.json",()=>{
      page.once("dialog",dialog=>dialog.accept());
      return page.getByRole("button",{name:"Open selected input draft",exact:true}).click();
    },bytes=>{
      const value=JSON.parse(bytes.toString("utf8"));check(value.current.scope.note===noteA&&value.incoming.value.scope.note===noteA,"The input reopen discarded writing.");
    });
    await page.waitForFunction(()=>document.querySelector("#ndtms-draft-status")?.textContent==="Input draft saved in this browser.");
    journal.evidence.ndtmsPortableDraft=inputDraft;await save();
  }else{
    await expand("Analyse an original source selection");
    await reopenInputDraft({page,root,input:inputDraft,workspaceId:nativeResult.sourceWorkspaceId,journal,save,fileReceipt,label:"Source_Input_Reopened"});
    await page.reload({waitUntil:"domcontentloaded"});await ready("ndtms");
  }
  await expand("Analyse an original source selection");await shot("ndtms-unfinished-input-reopened");
  const portable=await backupAndReceive();
  check(portable.receiving.originalWorkspace.id===nativeResult.sourceWorkspaceId,"The UI received another complete workspace.");
  const attachmentInspections=[];
  for(const attachment of attachments){
    const current=await fileReceipt(attachment.path);
    check(current.bytes===attachment.bytes&&current.sha256===attachment.sha256,"The frozen outgoing attachment differs.");
    const label="outgoing-"+path.basename(attachment.path).replace(/[^A-Za-z0-9_-]/g,"_");
    if(/\.html?$/i.test(attachment.path)){
      await viewArtifact(current,label,{print:true});
      attachmentInspections.push({...current,byteVerification:"EXACT",opening:"RENDERED_DESKTOP_MOBILE_PRINT",
        screenshots:journal.screenshots.filter(x=>x.name.startsWith(label+"-")),producerLook:"PENDING_PERSONAL_INSPECTION"});
    }else attachmentInspections.push({...current,byteVerification:"EXACT",opening:"PENDING_NATIVE_FORMAT_OPEN",
      screenshots:[],producerLook:"PENDING_PERSONAL_INSPECTION",
      required:/\.zip$/i.test(attachment.path)?"Open the actual archive, verify complete application membership and operate its extracted application.":
        /\.csv$/i.test(attachment.path)?"Open the exact CSV in a readable table and inspect the full original header/row population.":
        "Open this exact original file with its native viewer or corresponding application controls."});
  }
  journal.evidence.ndtmsAttachmentInspections=attachmentInspections;await save();
  const overview=await api("/api/overview");
  const result={schema:"nelc.ndtms-browser-course/v1",state:"COMPLETE",workspaceId:nativeResult.sourceWorkspaceId,
    revision:overview.workspace.revision,profileId:profile.id,originalNativeAnalysisId:nativeResult.analysisId,
    browserEditionId:edition.id,blockedAnalysisId:blocked.id,sourceCorrectionId:correctedOperation.result.id,
    analysisId:analysis.id,normalizedEditionId:normalized.id,contractId:contract.id,
    assessmentId:assessmentOperation.result.id,report,portable,inputDraft,
    clinicalCoverage:analysis.coverage,attachments,attachmentInspections,screenshots:journal.screenshots,
    producerLook:"Open these actual images and exact files; image generation alone does not complete personal visual review."};
  journal.evidence.ndtmsCourse=result;await save();return result;
}


/** Opens the exact downloaded full workspace at its independent receiving listener. */
export async function runNdtmsReceivedCourse({page,context,outputDirectory,nativeResult,sourceBrowserResult,runtime}) {
  const {api,open,ready,shot,journal,save,fileReceipt,stop}=runtime;
  check(sourceBrowserResult?.schema==="nelc.ndtms-browser-course/v1"&&sourceBrowserResult.state==="COMPLETE","Select the complete original browser result.");
  const root=path.resolve(outputDirectory),input=sourceBrowserResult.inputDraft;
  const actualInput=await fileReceipt(input.path);
  check(actualInput.sha256===input.sha256&&actualInput.bytes===input.bytes,"The original complete input draft changed.");
  const incoming=JSON.parse(await fs.readFile(input.path,"utf8"));
  const overview=await api("/api/overview");
  check(overview.workspace.id===sourceBrowserResult.workspaceId&&overview.workspace.id===nativeResult.sourceWorkspaceId,"The independent listener opened another workspace.");
  const analysis=await api("/api/record?"+new URLSearchParams({kind:"ndtms-analysis",id:sourceBrowserResult.analysisId}));
  check(analysis.ready&&analysis.counts.nativeClients===2&&analysis.counts.clientPartitionRows===3,"Independent receiving lost the consent-separated analysis.");
  const correction=await api("/api/record?"+new URLSearchParams({kind:"correction",id:sourceBrowserResult.sourceCorrectionId}));
  check(correction.from==="authored-conflict"&&correction.to==="authored-original","Independent receiving lost the original reviewed correction.");
  const contract=await api("/api/record?"+new URLSearchParams({kind:"contract",id:sourceBrowserResult.contractId}));
  check(contract.definition.editionId===sourceBrowserResult.normalizedEditionId&&contract.definition.tables.length===6,"Independent receiving lost the complete mapping.");
  await open("ndtms");
  let generation=Number(await page.locator("#main").getAttribute("data-generation"));
  await page.getByLabel("Retained analysis",{exact:true}).selectOption(analysis.id);await ready("ndtms",generation);
  const disclosure=page.locator("details").filter({has:page.locator("summary").filter({hasText:"Analyse an original source selection"})}).first();
  if(await disclosure.getAttribute("open")===null)await disclosure.locator("summary").first().click();
  if(journal.evidence.ndtmsInputReceived){
    const prior=journal.evidence.ndtmsInputReceived,stat=await fs.lstat(prior.path);
    check(stat.isFile()&&!stat.isSymbolicLink(),"The retained independent input recovery is not ordinary.");
    const observed=await fileReceipt(prior.path);
    check(observed.bytes===prior.bytes&&observed.sha256===prior.sha256,"The retained independent input recovery changed.");
    const value=JSON.parse(await fs.readFile(prior.path,"utf8"));
    check(value.workspaceId===overview.workspace.id&&stable(value.incoming)===stable(incoming),"The independent input recovery has another original source.");
  }
  const restoredReceipt=await reopenInputDraft({page,root,input,workspaceId:overview.workspace.id,journal,save,fileReceipt,label:"Independent_Input_Reopened"});
  journal.evidence.ndtmsInputReceived ||= restoredReceipt;await save();
  await page.reload({waitUntil:"domcontentloaded"});await ready("ndtms");
  const reopenedDisclosure=page.locator("details").filter({has:page.locator("summary").filter({hasText:"Analyse an original source selection"})}).first();
  if(await reopenedDisclosure.getAttribute("open")===null)await reopenedDisclosure.locator("summary").first().click();
  const restored=await page.locator('#ndtms-analysis-form textarea[name="scope_note"]').inputValue();
  check(restored===incoming.value.scope.note,"Independent cold reopening lost the complete unfinished input.");
  await shot("ndtms-independent-desktop");
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),"The independent view overflows mobile width.");
  await shot("ndtms-independent-mobile");
  await page.setViewportSize({width:1440,height:1000});
  await open("history");await shot("ndtms-independent-original-history");
  const result={schema:"nelc.ndtms-browser-independent/v1",state:"COMPLETE",workspaceId:overview.workspace.id,
    sourceAnalysisId:analysis.id,sourceCorrectionId:correction.id,contractId:contract.id,
    originalInputDraft:input,receivedInputDraft:journal.evidence.ndtmsInputReceived,
    sourceBackup:sourceBrowserResult.portable.backup,originalReceiving:sourceBrowserResult.portable.receiving,
    screenshots:journal.screenshots,producerLook:"Personally inspect these actual images and files before declaring the outgoing edition ready."};
  journal.evidence.ndtmsIndependent=result;await save();return result;
}
