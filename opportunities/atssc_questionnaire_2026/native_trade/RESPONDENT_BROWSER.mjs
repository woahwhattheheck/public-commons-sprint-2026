#!/usr/bin/env node
/** Operate the original saved ATSSC application through its visible browser forms. */
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {pathToFileURL,fileURLToPath} from "node:url";
const hash=raw=>createHash("sha256").update(raw).digest("hex");
const now=()=>new Date().toISOString();
export async function receiveRespondentBrowser({browser,baseUrl,operatorKey,outputDirectory,publicationId,tradeSourceId,runId=randomUUID()}){
  await mkdir(outputDirectory,{recursive:true,mode:0o700});
  const report={schema:"commons.atssc.respondent-browser-operation.v1",operation:"ATSSC-QUESTIONNAIRE-WORKSHARE-9FCD-20261012",started_at:now(),run_id:runId,phases:[],outputs:[],page_errors:[]};
  const contexts=[];let page;
  const save=async()=>writeFile(path.join(outputDirectory,"BROWSER_RESULT.json"),JSON.stringify(report,null,2)+"\n",{mode:0o600});
  const phase=async(name,result)=>{report.phases.push({name,at:now(),result});await save();process.stdout.write(JSON.stringify({phase:name,result})+"\n");};
  const newContext=async()=>{const context=await browser.newContext({viewport:{width:1365,height:900},acceptDownloads:true});contexts.push(context);context.on("page",p=>p.on("pageerror",e=>report.page_errors.push({message:String(e),url:p.url()})));return context;};
  const pure=async(context,method,params={})=>{const response=await context.request.post(baseUrl+"/api/invoke",{headers:{Origin:baseUrl},data:{method,params}});const value=await response.json();assert(response.ok(),JSON.stringify(value));return value.result;};
  const resultOf=async response=>{const value=await response.json();assert(response.ok()&&!value.error,JSON.stringify(value));return value.result;};
  const invoke=async(p,method,action)=>{
    const responsePromise=p.waitForResponse(response=>{
      if(!response.url().endsWith("/api/invoke"))return false;
      try{return response.request().postDataJSON()?.method===method;}catch{return false;}
    },{timeout:30000});
    await action();const result=await resultOf(await responsePromise);
    if(result?.revision!==undefined&&p===page){
      await p.waitForFunction(revision=>document.querySelector(".operator")?.textContent.includes("Edition "+revision)&&!document.querySelector(".pending"),result.revision,{timeout:30000});
    }
    return result;
  };
  const form=name=>page.locator('form[data-form="'+name+'"]');
  const sendForm=(name,method)=>invoke(page,"outreach."+method,()=>form(name).locator('button[type="submit"]').click());
  const tab=async name=>{await page.locator('[data-action="tab"][data-id="'+name+'"]').click();await page.locator('nav [data-id="'+name+'"][aria-current="page"]').waitFor();};
  const button=async(action,key,method)=>invoke(page,"outreach."+method,()=>page.locator('[data-action="'+action+'"]'+(key?'[data-id="'+key+'"]':"")).click());
  const clean=async p=>{const alerts=await p.locator('[role="alert"]').allTextContents();assert.equal(alerts.length,0,alerts.join("\n"));};
  const download=async(label,filename)=>{
    const pending=page.waitForEvent("download",{timeout:60000});
    await page.getByRole("link",{name:label,exact:true}).click();
    const item=await pending;const destination=path.join(outputDirectory,filename);
    await item.saveAs(destination);const raw=await readFile(destination);assert(raw.length>0);
    const receipt={name:filename,path:destination,bytes:raw.length,sha256:hash(raw),url:item.url(),suggested_filename:item.suggestedFilename()};
    report.outputs.push(receipt);await save();return receipt;
  };
  try{
    const operator=await newContext();page=await operator.newPage();page.setDefaultTimeout(20000);
    await page.goto(baseUrl+"/respondent-operations/");
    await page.locator('form[data-form="login"]').waitFor();
    await form("login").locator('[name="access_code"]').fill(operatorKey);
    const sessionPromise=page.waitForResponse(r=>r.url().endsWith("/api/session")&&r.request().method()==="POST");
    await form("login").getByRole("button",{name:"Open operator session",exact:true}).click();
    assert((await sessionPromise).ok());await page.locator("#actor").waitFor();
    await page.locator("#actor").fill("ATSSC browser receiving operator");
    await page.locator("#reason").fill("Operate the complete saved commissioning case through its original visible forms");
    const initial=await pure(operator,"outreach.status"),native=await pure(operator,"status");
    assert(publicationId&&native.publications.some(p=>p.id===publicationId),"Use the original published commissioning questionnaire");
    assert(tradeSourceId&&initial.sources.some(s=>s.id===tradeSourceId&&s.kind==="TRADE"),"Use the retained original trade edition");
    report.workspace_id=initial.workspace_id;report.initial_revision=initial.revision;
    await form("profile").locator('[name="application_url"]').fill(baseUrl);
    const profile=await sendForm("profile","save_profile");
    await phase("original_operator_case_opening_and_current_application_origin",{workspace_id:initial.workspace_id,revision:profile.revision,publication_id:publicationId});

    await tab("coverage");
    await form("coverage-preview").locator('[name="source_id"]').selectOption(tradeSourceId);
    await form("coverage-preview").locator('[name="target_percent"]').fill("80");
    await form("coverage-preview").locator('[name="negative_values_reviewed"]').check();
    const coverage=await sendForm("coverage-preview","preview_coverage");
    assert(coverage.ready&&coverage.groups.length>0,JSON.stringify(coverage.problems));
    assert(coverage.groups.every(g=>g.meets_target));
    await form("coverage-save").locator('[name="name"]').fill("Browser-reviewed original coverage "+runId);
    const savedCoverage=await sendForm("coverage-save","save_coverage");
    await phase("visible_whole_trade_coverage_review",{coverage_id:savedCoverage.coverage.id,groups:coverage.groups,selected_companies:coverage.counts.selected_companies});

    const suffix=runId.replaceAll("-","").slice(0,12),companyIds=["BROWSER-F-"+suffix,"BROWSER-G-"+suffix];
    const companyNames=["Browser receiving company F "+suffix,"Browser receiving company G "+suffix];
    const csv="Company ID,Company,Contact,Email,Country,Language\n"+companyIds[0]+","+companyNames[0]+",Browser receiving F,browser-f-"+suffix+"@commissioning.invalid,CA,EN\n"+companyIds[1]+","+companyNames[1]+",Browser receiving G,browser-g-"+suffix+"@commissioning.invalid,CA,FR\n";
    const originalName="Browser_Original_Contacts_"+suffix+".csv";
    await writeFile(path.join(outputDirectory,originalName),csv,{mode:0o600});
    await tab("sources");
    await form("source").locator('[name="file"]').setInputFiles({name:originalName,mimeType:"text/csv",buffer:Buffer.from(csv)});
    await form("source").locator('[name="kind"]').selectOption("CONTACTS");
    await form("source").locator('[name="format"]').selectOption("CSV");
    await sendForm("source","preview_source");
    await form("source-map").waitFor();
    for(const [field,column]of Object.entries({company_id:"A",company_name:"B",contact_name:"C",email:"D",country:"E",language:"F"})){
      await form("source-map").locator('[name="map.'+field+'"]').selectOption(column);
    }
    const mapped=await sendForm("source-map","preview_source");
    assert.equal(mapped.mapping.counts.rows,2);assert.equal(mapped.mapping.counts.valid,2);
    const retained=await sendForm("source-retain","receive_source");
    await tab("contacts");
    await form("contacts-source").locator('[name="source_id"]').selectOption(retained.source_id);
    const contactSource=await sendForm("contacts-source","get_source");assert.equal(contactSource.report.mapped.rows.length,2);
    await page.locator('[data-action="contact-bulk-create"]').click();
    await page.locator('tr[data-contact-row]').first().locator('[data-choice="kind"]').selectOption("GENERIC_INBOX");
    await sendForm("contacts-receive","receive_contacts");
    const contacts=await pure(operator,"outreach.status");
    for(const companyId of companyIds)assert.equal(contacts.contacts.filter(c=>c.company_id===companyId).length,1);
    await phase("visible_original_csv_mapping_all_row_contact_receiving",{source_id:retained.source_id,original_name:originalName,original_bytes:Buffer.byteLength(csv),original_sha256:hash(Buffer.from(csv)),company_ids:companyIds});

    await tab("assignments");
    await form("assignments").locator('[name="publication_id"]').selectOption(publicationId);
    for(const companyId of companyIds){
      await form("assignments").locator('[name="assign.'+companyId+'"]').check();
      const contact=contacts.contacts.find(c=>c.company_id===companyId);
      await form("assignments").locator('[name="contact.'+companyId+'"]').selectOption(contact.id);
    }
    await sendForm("assignments","assign");
    const assigned=await pure(operator,"outreach.status");
    const assignment=assigned.assignments.find(a=>a.company_id===companyIds[0]&&a.respondent.publication_id===publicationId);
    const second=assigned.assignments.find(a=>a.company_id===companyIds[1]&&a.respondent.publication_id===publicationId);
    assert(assignment&&second);const privateAssignment=(await button("assignment",assignment.id,"get_assignment")).assignment;
    assert.equal(privateAssignment.contact.kind,"GENERIC_INBOX");
    await phase("visible_original_company_assignments",{assignment_ids:[assignment.id,second.id],respondent_ids:[assignment.respondent_id,second.respondent_id],original_publication_id:publicationId});

    await tab("messages");
    const invitation=assigned.templates.find(t=>t.kind==="INVITATION"&&t.language==="EN");assert(invitation);
    await form("message-preview").locator('[name="assignment_id"]').selectOption(assignment.id);
    await form("message-preview").locator('[name="template_id"]').selectOption(invitation.id);
    const preview=await sendForm("message-preview","preview_message");
    assert.equal(preview.recipient,privateAssignment.contact.email);assert(preview.rendered.body.includes(companyNames[0]));
    const queued=await sendForm("message-retain","retain_message");
    await button("dispatch",queued.message.id,"dispatch");
    const message=(await pure(operator,"outreach.get_message",{id:queued.message.id})).message;
    assert.equal(message.delivery.state,"ACCEPTED");assert(message.wire.message_id);
    await phase("visible_review_queue_and_native_relay_submission",{message_id:message.id,recipient:message.recipient,wire:message.wire,delivery:message.delivery});

    const respondentContext=await newContext(),respondent=await respondentContext.newPage();
    await respondent.goto(baseUrl+privateAssignment.entry_path);
    await respondent.locator("#access-code").fill(privateAssignment.access_code);
    const respondentSession=respondent.waitForResponse(r=>r.url().endsWith("/api/session")&&r.request().method()==="POST");
    await respondent.getByRole("button",{name:"Open workspace",exact:true}).click();assert((await respondentSession).ok());
    const companyAnswer=respondent.getByLabel("Company name *",{exact:true});
    await companyAnswer.fill(companyNames[0]);
    await respondent.getByLabel("Reported value *",{exact:true}).fill("250.00");
    await respondent.getByLabel("I confirm the public answers and public alternatives may be released publicly",{exact:true}).check();
    const progress=await invoke(respondent,"save_progress",()=>respondent.getByRole("button",{name:"Save progress",exact:true}).click());
    await respondent.reload();await companyAnswer.waitFor();assert.equal(await companyAnswer.inputValue(),companyNames[0]);
    const response=await invoke(respondent,"submit_revision",()=>respondent.getByRole("button",{name:"Submit answer revision",exact:true}).click());
    assert(response.validation.valid,JSON.stringify(response.validation.issues));
    assert.equal(response.notifications.prepared_count,2);assert(!response.notifications.messages);
    await phase("original_respondent_saved_progress_reopen_and_submission",{respondent_id:privateAssignment.respondent_id,draft_version:progress.draft_version,revision_id:response.revision_id,number:response.number,public_confirmed:response.validation.public_confirmed});

    await respondent.getByRole("link",{name:"Update my contact information",exact:true}).click();
    const contactForm=respondent.locator('form[data-form="respondent-contact"]');
    await contactForm.locator('[name="phone"]').fill("+1 555 0198");
    await contactForm.locator('[name="language"]').selectOption("FR");
    await invoke(respondent,"outreach.update_respondent_contact",()=>contactForm.locator('button[type="submit"]').click());
    await respondent.getByRole("heading",{name:"Vos coordonnées",exact:true}).waitFor();
    await page.locator('[data-action="refresh"]').click();
    await tab("followups");
    const due=await sendForm("followups-read","followups");
    assert(due.items.filter(i=>i.assignment_id===assignment.id).every(i=>!i.eligible));
    const current=(await pure(operator,"outreach.get_assignment",{id:assignment.id})).assignment;
    assert.equal(current.language,"FR");assert.equal(current.contact.phone,"+1 555 0198");
    await form("followup-log").locator('[name="assignment_id"]').selectOption(assignment.id);
    await form("followup-log").locator('[name="channel"]').selectOption("PHONE");
    await form("followup-log").locator('[name="outcome"]').selectOption("ASSISTANCE");
    await form("followup-log").locator('[name="original_source"]').fill("Original browser receiving contact record "+runId);
    await form("followup-log").locator('[name="note"]').fill("The respondent saved, reopened and submitted the original questionnaire, then updated the contact language and phone number.");
    await sendForm("followup-log","log_followup");
    await phase("own_contact_language_and_original_received_followup_suppression",{respondent_id:current.respondent_id,language:current.language,due_items:due.items.filter(i=>i.assignment_id===assignment.id)});

    await tab("assignments");
    await form("public-link").locator('[name="name"]').fill("French browser receiving entry "+runId);
    await form("public-link").locator('[name="publication_id"]').selectOption(publicationId);
    await form("public-link").locator('[name="language"]').selectOption("FR");
    const publicLink=await sendForm("public-link","save_public_link");
    const publicContext=await newContext(),publicPage=await publicContext.newPage();
    await publicPage.goto(baseUrl+"/public/entry/"+encodeURIComponent(publicLink.link.token));
    const entry=publicPage.locator('form[data-form="public-entry"]');await entry.waitFor();
    await entry.locator('[name="company_name"]').fill(companyNames[0]);
    await entry.locator('[name="contact_name"]').fill("French public browser contact");
    await entry.locator('[name="email"]').fill("public-browser-"+suffix+"@commissioning.invalid");
    await entry.locator('[name="country"]').fill("CA");
    const registeredResponse=publicPage.waitForResponse(r=>r.url().endsWith("/api/outreach/public-entry"));
    await entry.getByRole("button",{name:"Créer mon accès",exact:true}).click();
    const registration=await resultOf(await registeredResponse);
    const withPublic=await pure(operator,"outreach.status");
    const publicAssignment=withPublic.assignments.find(a=>a.respondent_id===registration.respondent_id);
    assert(publicAssignment&&publicAssignment.company_id!==companyIds[0]);
    assert.equal(publicAssignment.registration_state,"NEW_COMPANY_CONTACT_REVIEW");
    await publicPage.getByRole("button",{name:"Ouvrir votre questionnaire",exact:true}).click();
    await publicPage.getByRole("button",{name:"Save progress",exact:true}).waitFor();
    await phase("french_public_company_entry_and_private_original_questionnaire",{respondent_id:registration.respondent_id,company_id:publicAssignment.company_id,registration_state:publicAssignment.registration_state});

    const layouts=[];
    for(const viewport of [{width:1365,height:900},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      for(const section of ["case","sources","coverage","contacts","assignments","messages","followups","exports"]){
        await tab(section);await clean(page);
        const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,heading:document.querySelector("main h2")?.textContent}));
        assert(size.document<=viewport.width+1&&size.body<=viewport.width+1,JSON.stringify({section,viewport,size}));
        layouts.push({section,...size});
      }
    }
    await respondent.setViewportSize({width:390,height:844});await publicPage.setViewportSize({width:390,height:844});
    for(const p of [respondent,publicPage]){
      await clean(p);const size=await p.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      assert(size.document<=391,JSON.stringify(size));
    }
    await page.setViewportSize({width:1365,height:900});await tab("exports");
    await sendForm("history-read","history");
    await download("Editable operating workbook","ATSSC_Browser_Operating_Workbook.xlsx");
    await download("Operating files and originals","ATSSC_Browser_Operating_Files.zip");
    await download("Complete original project","ATSSC_Browser_Complete_Project.zip");
    const final=await pure(operator,"outreach.status");
    await phase("whole_visible_history_downloads_and_desktop_phone_operation",{layouts,workspace_id:final.workspace_id,revision:final.revision,original_sources:final.sources.length,companies:final.companies.length,assignments:final.assignments.length});
    assert.equal(report.page_errors.length,0,JSON.stringify(report.page_errors));
    report.status="PASS";report.finished_at=now();report.revision=final.revision;await save();return report;
  }catch(error){report.status="FAILED";report.finished_at=now();report.error={name:error.name,message:error.message,stack:error.stack};await save();throw error;}
  finally{for(const context of contexts)await context.close();}
}
async function main(){
  const config=JSON.parse(await readFile(process.argv[2],"utf8"));
  const resolver=createRequire(import.meta.url);
  const modulePath=config.playwright_module||process.env.ATSSC_PLAYWRIGHT_MODULE;
  const moduleSpecifier=modulePath||(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,"playwright"):"playwright");
  const imported=await import(pathToFileURL(resolver.resolve(moduleSpecifier)).href);
  const chromium=imported.chromium||imported.default?.chromium;
  assert(chromium,"The selected saved Playwright entry must expose its Chromium launcher");
  const executablePath=config.chrome_path||process.env.ATSSC_CHROME_PATH;
  assert(executablePath,"Use the exact saved browser runtime for this receiving operation");
  const browser=await chromium.launch({executablePath,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  try{const result=await receiveRespondentBrowser({...config,browser});process.stdout.write(JSON.stringify({complete:true,status:result.status,workspace_id:result.workspace_id,revision:result.revision,outputs:result.outputs})+"\n");}
  finally{await browser.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{process.stderr.write(error.stack+"\n");process.exitCode=1;});
