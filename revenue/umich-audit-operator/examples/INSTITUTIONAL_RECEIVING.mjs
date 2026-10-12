// Complete institutional operator receiving journey on an original retained audit case.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const ready=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const root=ready.operation_root, resultFile=ready.browser_result;
const privateState=JSON.parse(fs.readFileSync(ready.private_state_file,"utf8"));
const originalWorkspace=ready.workspace;
let workspace=originalWorkspace, owner, browser, ownerContext;
let journal=fs.existsSync(resultFile)?JSON.parse(fs.readFileSync(resultFile,"utf8")):{
  schema:"commons-audit-institutional-browser/1",status:"RUNNING",
  run_id:crypto.randomUUID(),phases:{},created_at:new Date().toISOString(),
};
const errors=[], pending=new Map();
const input=readline.createInterface({input:process.stdin});
input.on("line",line=>{let value;try{value=JSON.parse(line);}catch{return;}const p=pending.get(value.id);if(!p)return;pending.delete(value.id);clearTimeout(p.timer);value.ok?p.resolve(value.value):p.reject(new Error(value.error));});
const bridge=(command,values={})=>new Promise((resolve,reject)=>{
 const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(new Error("The owning native bridge did not return "+command));},30000);
 pending.set(id,{resolve,reject,timer});console.log("UMICH_BRIDGE "+JSON.stringify({id,command,...values}));
});
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const save=()=>{const t=resultFile+".writing";fs.writeFileSync(t,JSON.stringify(journal,null,2)+"\n",{mode:0o600});fs.renameSync(t,resultFile);};
const fileIdentity=p=>{const b=fs.readFileSync(p);return{path:p,bytes:b.length,sha256:hash(b)};};
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const phase=async(name,fn)=>{
 if(journal.phases[name])return journal.phases[name];
 journal.active_phase=name;journal.status="RUNNING";save();console.log("UMICH_STAGE "+JSON.stringify({stage:name,status:"started"}));
 const value=await fn();journal.phases[name]={...value,completed_at:new Date().toISOString(),source_selection_sha256:ready.source_selection_sha256};journal.active_phase=null;save();
 console.log("UMICH_STAGE "+JSON.stringify({stage:name,status:"completed"}));return journal.phases[name];
};
const url=(route,query={},wk=workspace)=>ready.origin+route+"?"+new URLSearchParams({...query,workspace:wk});
async function request(context,route,query={},body=undefined,wk=workspace){
 const response=body===undefined?await context.request.get(url(route,query,wk)):
  await context.request.post(url(route,query,wk),{data:body,headers:{"Content-Type":"application/json","X-Audit-Request":"1","Origin":ready.origin}});
 let value;try{value=await response.json();}catch{throw new Error("The original response did not contain JSON: "+route+" "+response.status());}
 return{status:response.status(),value,response};
}
async function api(context,route,query={},body=undefined,wk=workspace){
 const r=await request(context,route,query,body,wk);if(r.status<200||r.status>=300)throw new Error(route+" "+r.status+" "+(r.value.error||"request failed"));return r.value;
}
const state=(context=ownerContext,wk=workspace)=>api(context,"/api/identity/state",{},undefined,wk);
async function actionResponse(page,name,click){
 const observed=page.waitForResponse(r=>{
  if(!r.url().includes("/api/action?")||r.request().method()!=="POST")return false;
  try{return r.request().postDataJSON().action===name;}catch{return false;}
 }).then(async r=>({status:r.status(),value:await r.json(),request:r.request().postDataJSON()}));
 await click();return await observed;
}
async function submit(page,name,expected=200){
 const r=await actionResponse(page,name,()=>page.locator("#ip-save").click());
 assert(r.status===expected,name+" returned "+r.status+": "+(r.value.error||""));
 if(expected===200)await page.locator("#editor").waitFor({state:"hidden"});
 return r;
}
async function mainRoute(page,label,heading){
 const menu=page.locator("#menu-toggle");
 if(await menu.isVisible() && await menu.getAttribute("aria-expanded")!=="true")await menu.click();
 await page.locator("#navigation").getByRole("button",{name:label,exact:true}).click();
 await page.getByRole("heading",{name:heading,exact:true}).first().waitFor();
 if(await page.locator("#page > .error").count())throw new Error(await page.locator("#page > .error").innerText());
}
async function identityPage(page=owner){await mainRoute(page,"Institutional access","Institutional access");}
async function tab(name,page=owner){
 await page.locator('[data-identity-action="section"][data-id="'+name+'"]').click();
 await page.locator('[data-identity-action="section"][data-id="'+name+'"][aria-current="page"]').waitFor();
}
async function fill(page,values){for(const [selector,value]of Object.entries(values))await page.locator(selector).fill(String(value));}
async function signInOwner(page=owner,wk=workspace,keyFile=ready.owner_key_file){
 await page.goto(url("/",{},wk),{waitUntil:"domcontentloaded"});
 if(await page.locator("#login").isVisible()){
  await page.getByLabel("Workspace access key",{exact:true}).fill(fs.readFileSync(keyFile,"utf8").trim());
  await page.getByRole("button",{name:"Open workspace",exact:true}).click();
 }
 await page.getByRole("heading",{name:"Audit workspace",exact:true}).waitFor();
}
function watch(page){page.setDefaultTimeout(25000);page.on("pageerror",error=>errors.push(error.message));return page;}
async function persona(subject,{wk=workspace,expected="opened"}={}){
 const context=await browser.newContext({viewport:{width:1360,height:960},ignoreHTTPSErrors:true,acceptDownloads:true});
 const page=watch(await context.newPage());
 await page.goto(url("/",{},wk),{waitUntil:"domcontentloaded"});
 await page.getByRole("button",{name:"Sign in with "+ready.provider.label,exact:true}).click();
 await page.getByRole("heading",{name:"Organization sign-in",exact:true}).waitFor();
 await page.locator("#subject").selectOption(subject==="native-staff-001"||subject==="native-applicant-001"?subject:"__custom__");
 if(!["native-staff-001","native-applicant-001"].includes(subject))await page.locator("#literal_subject").fill(subject);
 await page.getByRole("button",{name:"Continue",exact:true}).click();
 if(expected==="opened")await page.locator("#shell").waitFor({state:"visible"});
 else{
  await page.locator("#login").waitFor({state:"visible"});
  const wanted=expected==="access_review"?"requires a workspace access review":"Sign-in did not complete";
  await page.locator("#login-error").filter({hasText:wanted}).waitFor();
 }
 return{context,page};
}
async function logout(pair,wk=workspace){await request(pair.context,"/api/logout",{}, {},wk);await pair.context.close();}
async function providerRecord(){return(await state()).providers.find(r=>r.id===journal.provider_id || r.payload.configuration.label===ready.provider.label);}
async function activateProvider(page=owner,wk=workspace){
 const data=await state(ownerContext,wk),provider=data.providers.find(r=>r.id===journal.provider_id);
 assert(provider,"The selected provider is retained.");
 if(provider.payload.enabled && provider.payload.activation_epoch===data.identity_epoch)return provider;
 await identityPage(page);await tab("providers",page);
 await page.locator('[data-identity-action="activate-provider"][data-id="'+provider.id+'"]').click();
 await page.locator("#ip-activation-note").fill("Practice receiving owner reviewed exact HTTPS registration, two distinct owners and retained discovery metadata.");
 await submit(page,"identity.provider.activate");
 return(await state(ownerContext,wk)).providers.find(r=>r.id===provider.id);
}
async function inspectProvider(page=owner){
 await identityPage(page);await tab("providers",page);
 const observed=actionResponse(page,"identity.provider.inspect",()=>page.locator('[data-identity-action="inspect-provider"][data-id="'+journal.provider_id+'"]').click());
 const r=await observed;assert(r.status===200,"Discovery must be retained by the original provider operation.");
 await page.getByRole("heading",{name:"Discovery metadata retained",exact:true}).waitFor();
 await page.locator("#close-dialog").click();return r.value.record;
}
async function account(subject,assignment,{page=owner,context=ownerContext,mode="manual",status="active",label=subject}={}){
 const current=(await state(context)).accounts.find(r=>r.payload.subject===subject),p=current?.payload;
 const desired={role:assignment?.role||"unit_leadership",unit_ids:assignment?.unit_ids||[],recipient_unit_ids:assignment?.recipient_unit_ids||[],selected_record_ids:assignment?.selected_record_ids||[]};
 const same=p&&p.mode===mode&&p.status===status&&p.label===label&&(mode==="rules"||equal(p.manual_access,desired));
 if(same)return current;
 await identityPage(page);await tab("accounts",page);
 await page.locator(current?'[data-identity-action="account"][data-id="'+current.id+'"]':'[data-identity-action="new-account"]').click();
 if(!current)await page.locator("#ip-account-subject").fill(subject);
 await page.locator("#ip-account-label").fill(label);
 await page.locator("#ip-account-mode").selectOption(mode);await page.locator("#ip-account-status").selectOption(status);
 if(mode==="manual"){
  await page.locator("#ip-account-access-role").selectOption(desired.role);
  await fill(page,{"#ip-account-access-units":desired.unit_ids.join("\n"),"#ip-account-access-recipients":desired.recipient_unit_ids.join("\n"),"#ip-account-access-records":desired.selected_record_ids.join("\n")});
 }
 await page.locator("#ip-account-note").fill("Practice named assignment in original institutional receiving "+journal.run_id);
 const r=await submit(page,"identity.account.save");return r.value.record;
}
async function mapping(label,condition,{enabled=true,role="auditor",units=[]}={}){
 const current=(await state()).rules.find(r=>r.payload.label===label);
 if(current&&current.payload.enabled===enabled&&equal(current.payload.conditions,[condition]))return current;
 await identityPage();await tab("mappings");
 await owner.locator(current?'[data-identity-action="mapping"][data-id="'+current.id+'"]':'[data-identity-action="new-mapping"]').click();
 await owner.locator("#ip-mapping-label").fill(label);
 await owner.locator("#ip-condition-0-claim").selectOption(condition.claim);
 await owner.locator("#ip-condition-0-comparison").selectOption(condition.comparison);
 await owner.locator("#ip-condition-0-value").fill(condition.value);
 await owner.locator("#ip-mapping-access-role").selectOption(role);await owner.locator("#ip-mapping-access-units").fill(units.join("\n"));
 await owner.locator("#ip-mapping-enabled").setChecked(enabled);
 await owner.locator("#ip-mapping-note").fill("Practice reviewed exact signed-claim mapping "+journal.run_id);
 return(await submit(owner,"identity.rule.save")).value.record;
}
async function capture(page,name){
 const geometry=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,width:document.documentElement.scrollWidth}));
 assert(geometry.width<=geometry.viewport+1,name+" has page-wide overflow.");
 const p=path.join(root,name);await page.screenshot({path:p,fullPage:true});return{...fileIdentity(p),geometry};
}
async function artifact(context,row,name,wk=workspace){
 const r=await context.request.get(url("/api/artifact/download",{id:row.id},wk));assert(r.ok(),"Read the original saved artifact.");
 const body=await r.body();assert(body.length===row.payload.bytes&&hash(body)===row.payload.sha256,"Saved artifact bytes must match the original descriptor.");
 const p=path.join(root,name);if(fs.existsSync(p))assert(hash(fs.readFileSync(p))===hash(body),"The named retained artifact already has different bytes.");
 else fs.writeFileSync(p,body,{mode:0o600});return fileIdentity(p);
}
async function encryptedBackup(label,name){
 let row=(await api(ownerContext,"/api/artifacts")).artifacts.find(r=>r.payload.detail?.label===label&&r.payload.detail?.encrypted);
 if(!row){
  await mainRoute(owner,"Backup & recovery","Backup & recovery");
  await fill(owner,{"#backup-label":label,"#backup-pass":privateState.backup_passphrase,"#backup-repeat":privateState.backup_passphrase});
  const r=await actionResponse(owner,"backup",()=>owner.getByRole("button",{name:"Create encrypted snapshot",exact:true}).click());
  assert(r.status===200,"Create the complete original encrypted backup.");row=r.value.artifact;
 }
 return{record:row,artifact:await artifact(ownerContext,row,name)};
}
try {
 const playwright=require(ready.playwright);
 browser=await playwright.chromium.launch({headless:true,executablePath:ready.chromium,args:["--no-sandbox","--disable-dev-shm-usage"]});
 ownerContext=await browser.newContext({viewport:{width:1440,height:1050},ignoreHTTPSErrors:true,acceptDownloads:true});
 owner=watch(await ownerContext.newPage());await signInOwner();
 if(!journal.baseline){
  const records=await api(ownerContext,"/api/records",{limit:"1000"});
  const engagements=records.items.map(x=>x.record).filter(r=>r.kind==="engagement");
  const units=[...new Set(engagements.flatMap(r=>r.payload.unit_ids))].sort();
  assert(units.length>=2&&engagements.length>=3,"Use the original completed multi-unit audit case.");
  const memo=records.items.map(x=>x.record).find(r=>r.kind==="advisory_memo");
  assert(memo,"The original advisory scope remains present.");
  journal.baseline={units,engagement_ids:engagements.map(r=>r.id),engagements:engagements.map(r=>({id:r.id,unit_ids:r.payload.unit_ids,is_it_audit:r.payload.is_it_audit,is_michigan_medicine:r.payload.is_michigan_medicine})),memo_id:memo.id,memo_units:memo.payload.recipient_unit_ids,records:records.items.length};
  save();
 }
 const unitA=journal.baseline.units[0],unitB=journal.baseline.units[1];
 await phase("provider-registration-metadata-and-owner-review",async()=>{
  let r=await providerRecord(), duplicate_rejected=false;
  if(!r){
   await identityPage();await tab("providers");
   await owner.locator('[data-identity-action="new-provider"]').click();
   const id=await owner.locator("#ip-provider-id").inputValue();
   journal.provider_id=id;save();await bridge("register_callback",{workspace,provider_id:id});
   await fill(owner,{"#ip-provider-label":ready.provider.label,"#ip-provider-issuer":ready.provider.issuer,
    "#ip-provider-client":ready.provider.client_id,"#ip-provider-secret":ready.provider.client_secret_env,
    "#ip-provider-ca":ready.provider.ca_bundle_env,"#ip-provider-origins":ready.provider.issuer,
    "#ip-provider-scopes":"openid\nprofile","#ip-provider-claims":"name","#ip-provider-age":"300",
    "#ip-provider-duration":"120","#ip-provider-idle":"30","#ip-provider-contact":"Practice receiving operator",
    "#ip-owner-0-name":"Practice integration owner A","#ip-owner-0-email":"owner-a@example.invalid","#ip-owner-0-affiliation":"Practice application owner",
    "#ip-owner-1-name":"Practice integration owner B","#ip-owner-1-email":"owner-a@example.invalid","#ip-owner-1-affiliation":"Practice identity owner",
    "#ip-provider-enrollment":"Maintained local HTTPS registration "+ready.source_selection_sha256,
    "#ip-provider-notes":"Original retained audit case. Local HTTPS code/PKCE provider source 1cde024a; explicit name claim.",
    "#ip-provider-change":"Commission the actual private receiving registration and preserve this source edition."});
   const invalid=await submit(owner,"identity.provider.save",400);assert(invalid.value.error.includes("distinct"),"Two duplicate owner identities cannot commission a provider.");duplicate_rejected=true;
   await owner.locator("#ip-owner-1-email").fill("owner-b@example.invalid");
   r=(await submit(owner,"identity.provider.save")).value.record;
  }
  journal.provider_id=r.id;save();await bridge("register_callback",{workspace,provider_id:r.id});
  if(!r.payload.metadata)r=await inspectProvider();
  r=await activateProvider();
  return{provider_id:r.id,revision:r.revision,issuer:r.payload.configuration.issuer,metadata_sha256:r.payload.metadata_sha256,
   owners:r.payload.configuration.owners,callback:r.payload.configuration.redirect_uri,duplicate_owner_rejected:duplicate_rejected||journal.phases["provider-registration-metadata-and-owner-review"]?.duplicate_owner_rejected===true};
 });
 await phase("reviewed-mapping-and-eight-original-role-assignments",async()=>{
  const rule=await mapping("Practice signed staff claim",{claim:"name",comparison:"equals",value:"Native staff member"});
  const choices=[
   {subject:"native-staff-001",role:"auditor",mode:"rules",unit_ids:[]},
   {subject:"umich-practice-unit",role:"unit_leadership",unit_ids:[unitA]},
   {subject:"umich-practice-executive",role:"executive",unit_ids:[]},
   {subject:"umich-practice-it",role:"it_leadership",unit_ids:[unitA]},
   {subject:"umich-practice-medicine",role:"medicine_it_leadership",unit_ids:[unitA]},
   {subject:"umich-practice-board",role:"board_regents",unit_ids:[]},
   {subject:"umich-practice-faic",role:"faic",unit_ids:[]},
   {subject:"umich-practice-advisory",role:"advisory",unit_ids:journal.baseline.memo_units,recipient_unit_ids:journal.baseline.memo_units,selected_record_ids:[journal.baseline.memo_id]},
  ];
  const rows=[];
  for(const choice of choices){const r=await account(choice.subject,choice,{mode:choice.mode||"manual",label:"Practice "+choice.role});rows.push({id:r.id,subject:choice.subject,role:choice.role});}
  journal.role_accounts=rows;save();return{mapping_id:rule.id,accounts:rows,unit_ids:[unitA,unitB]};
 });
 await phase("actual-code-flow-and-original-audience-projections",async()=>{
  const outcomes=[];
  for(const configured of journal.role_accounts){
   const pair=await persona(configured.subject);
   const current=await api(pair.context,"/api/state");
   assert(current.actor.id===configured.id && current.actor.role===configured.role,"The verified subject must open its original assigned role.");
   assert(current.actor.admin===false,"Institutional access must preserve the original private owner boundary.");
   const records=(await api(pair.context,"/api/records",{limit:"1000"})).items.map(x=>x.record);
   assert(records.length>0,"The original role must have its supplied practice projection.");
   assert(!records.some(r=>r.kind.startsWith("identity_")),"Audit projections must exclude institutional administration records.");
   if(configured.role==="unit_leadership"){
    const observations=records.filter(r=>r.kind==="observation");
    assert(observations.every(r=>r.payload.owner_unit===unitA),"Unit leadership must retain its actual unit scope.");
    await mainRoute(pair.page,"Observations","Observations");
    journal.unit_projection_screenshot=await capture(pair.page,"institutional-unit-observations.png");save();
   }
   if(configured.role==="advisory")assert(records.every(r=>["engagement","advisory_memo"].includes(r.kind)),"Advisory receives its original selected memos and minimal engagement references.");
   if(configured.role==="medicine_it_leadership"){const allowed=new Set(journal.baseline.engagements.filter(r=>r.is_michigan_medicine&&r.is_it_audit&&r.unit_ids.includes(unitA)).map(r=>r.id));assert(records.filter(r=>r.kind==="engagement").every(r=>allowed.has(r.id)),"Medicine IT keeps both explicit source flags and the selected unit.");}
   if(!["auditor","unit_leadership"].includes(configured.role)){
    assert(!JSON.stringify(records).includes("A_PRIVATE_DETAIL")&&!JSON.stringify(records).includes("B_PRIVATE_DETAIL"),"Senior and advisory projections keep original detail boundaries.");
   }
   const ip=await state(pair.context);
   assert(ip.providers.length===0&&ip.rules.length===0,"An assigned audit role must not become provider administrator.");
   const forbidden=await request(pair.context,"/api/record",{kind:"identity_provider",id:journal.provider_id});
   assert(forbidden.status===403,"Generic record access must preserve the provider owner boundary.");
   if(configured.role==="auditor"){
    const history=await request(pair.context,"/api/history",{kind:"identity_provider",id:journal.provider_id});
    assert(history.status===403,"Generic history cannot reveal another identity scope.");
    const activity=await api(pair.context,"/api/operations",{limit:"100",event_limit:"100"});
    assert(activity.operations.every(r=>!r.action.startsWith("identity.")),"General audit activity excludes identity administration.");
    assert(activity.events.every(r=>!r.action.startsWith("institutional_")&&!r.action.startsWith("identity_")&&!String(r.detail.kind||"").startsWith("identity_")&&r.action!=="access_administration_changed"),"General audit events retain their business scope.");
   }
   outcomes.push({role:configured.role,account_id:current.actor.id,records:records.length,provider_administration:false,identity_record_status:forbidden.status});
   await logout(pair);
  }
  const inspected=await bridge("inspect",{workspace});
  assert(inspected.provider.counts.pkce>=8&&inspected.provider.counts.code_consumed>=8,"The maintained provider must consume actual PKCE-bound codes.");
  return{audiences:outcomes,provider:inspected.provider,unit_screenshot:journal.unit_projection_screenshot};
 });
 await phase("delegated-unit-administration-and-corrected-assignment",async()=>{
  const adminAccount=journal.role_accounts.find(r=>r.role==="unit_leadership");
  let d=(await state()).delegations.find(r=>r.payload.grantee_id===adminAccount.id&&r.payload.roles.includes("unit_leadership")&&r.payload.unit_ids.includes(unitA));
  if(!d){
   await identityPage();await tab("delegations");
   await owner.locator('[data-identity-action="new-delegation"]').click();
   await owner.locator("#ip-delegation-grantee").selectOption(adminAccount.id);
   await owner.locator('input[id^="ip-delegation-role-"][value="unit_leadership"]').check();
   await owner.locator("#ip-delegation-units").fill(unitA);
   await owner.locator("#ip-delegation-note").fill("Practice accountable unit administrator; original "+unitA+" scope only. "+journal.run_id);
   d=(await submit(owner,"identity.delegation.save")).value.record;
  }
  journal.delegation_id=d.id;save();
  const pair=await persona(adminAccount.subject);
  const caps=(await state(pair.context)).capabilities;
  assert(caps.can_administer&&caps.units_by_role.unit_leadership.includes(unitA)&&!caps.owner,"Named delegation must resolve through the original current session.");
  await identityPage(pair.page);await tab("accounts",pair.page);
  assert(await pair.page.locator('[data-identity-action="new-provider"]').count()===0,"The delegate has no provider commissioning surface.");
  let child=(await state(pair.context)).accounts.find(r=>r.payload.subject==="umich-practice-delegated");
  let corrected_scope=false;
  if(!child){
   await pair.page.locator('[data-identity-action="new-account"]').click();
   await fill(pair.page,{"#ip-account-subject":"umich-practice-delegated","#ip-account-label":"Practice delegated unit recipient","#ip-account-access-units":unitB,"#ip-account-note":"Practice reviewed unit receiving assignment "+journal.run_id});
   await pair.page.locator("#ip-account-access-role").selectOption("unit_leadership");
   const rejected=await submit(pair.page,"identity.account.save",403);
   assert(rejected.value.error.includes("declared roles and unit scope"),"The original delegate cannot assign another unit.");
   assert(await pair.page.locator("#ip-account-subject").inputValue()==="umich-practice-delegated","The operator form must preserve its authored correction.");
   await pair.page.locator("#ip-account-access-units").fill(unitA);
   child=(await submit(pair.page,"identity.account.save")).value.record;corrected_scope=true;
  }
  journal.delegated_account_id=child.id;save();
  await tab("accounts",pair.page);
  const screenshot=await capture(pair.page,"institutional-delegated-administration.png");
  await logout(pair);
  const recipient=await persona("umich-practice-delegated");
  assert((await api(recipient.context,"/api/state")).actor.id===child.id,"The delegated assignment must be usable by its actual verified subject.");
  const observations=(await api(recipient.context,"/api/records",{kind:"observation"})).items.map(x=>x.record);
  assert(observations.every(r=>r.payload.owner_unit===unitA),"The delegated recipient retains the same original unit projection.");
  await logout(recipient);
  return{delegation_id:d.id,account_id:child.id,corrected_scope,unit:unitA,receiving_observations:observations.length,screenshot};
 });
 await phase("pending-account-review-and-device-session-lifecycle",async()=>{
  let pendingAccount=(await state()).accounts.find(r=>r.payload.subject==="umich-practice-reviewed");
  if(!pendingAccount){
   const pendingPair=await persona("umich-practice-reviewed",{expected:"access_review"});
   assert((await request(pendingPair.context,"/api/state")).status===401,"An unassigned verified identity awaits access review.");
   await pendingPair.context.close();
   pendingAccount=(await state()).accounts.find(r=>r.payload.subject==="umich-practice-reviewed");
  }
  assert(pendingAccount,"The original verified pending identity must remain available for administration.");
  const approved=await account("umich-practice-reviewed",{role:"executive"},{label:"Practice reviewed executive"});
  const approvedPair=await persona("umich-practice-reviewed");
  assert((await api(approvedPair.context,"/api/state")).actor.id===approved.id,"The reviewed original subject must open its saved assignment.");
  await logout(approvedPair);
  const first=await persona("umich-practice-unit"),second=await persona("umich-practice-unit");
  const firstState=await state(first.context),secondState=await state(second.context);
  assert(firstState.request_session_id&&secondState.request_session_id&&firstState.request_session_id!==secondState.request_session_id,"Two actual devices must have separate session identities.");
  await identityPage(first.page);await tab("sessions",first.page);
  const revoke=await actionResponse(first.page,"identity.session.revoke",()=>first.page.locator('[data-identity-action="revoke-session"][data-id="'+firstState.request_session_id+'"]').click());
  assert(revoke.status===200&&revoke.value.revoked,"Close the selected actual device session.");
  assert((await request(first.context,"/api/state")).status===401,"The closed device must lose its current session.");
  assert((await request(second.context,"/api/state")).status===200,"A separate current device remains open until its own authority changes.");
  await first.context.close();
  const disabled=await account("umich-practice-unit",{role:"unit_leadership",unit_ids:[unitA]},{label:"Practice unit_leadership",status:"disabled"});
  assert((await request(second.context,"/api/state")).status===401,"Disabling the account closes its other active device.");
  await second.context.close();
  const restored=await account("umich-practice-unit",{role:"unit_leadership",unit_ids:[unitA]},{label:"Practice unit_leadership",status:"active"});
  return{reviewed_account_id:approved.id,first_session_id:firstState.request_session_id,second_session_id:secondState.request_session_id,
   one_device_closed:true,other_device_preserved:true,account_disable_applied:true,disabled_revision:disabled.revision,restored_revision:restored.revision};
 });
 await phase("overlapping-mapping-review-and-signed-response-recovery",async()=>{
  let overlap=(await state()).rules.find(r=>r.payload.label==="Practice overlapping staff selection");
  if(!overlap)overlap=await mapping("Practice overlapping staff selection",{claim:"sub",comparison:"equals",value:"native-staff-001"});
  if(overlap.payload.enabled){
   const held=await persona("native-staff-001",{expected:"access_review"});
   assert((await request(held.context,"/api/state")).status===401,"Overlapping signed-claim mappings must await explicit review.");
   await held.context.close();
   overlap=await mapping("Practice overlapping staff selection",{claim:"sub",comparison:"equals",value:"native-staff-001"},{enabled:false});
  }
  const corrected=await persona("native-staff-001");assert((await api(corrected.context,"/api/state")).actor.role==="auditor","The corrected unique mapping must reopen its original role.");
  await logout(corrected);
  const secret=fs.readFileSync(ready.provider.control_secret_file,"utf8");
  const control=async mode=>{const response=await ownerContext.request.post(ready.provider.control_url,{data:{mode},headers:{Authorization:"Bearer "+secret}});assert(response.ok(),"The original private provider mode must change.");return await response.json();};
  try{
   await control("wrong_nonce");
   const invalid=await persona("native-staff-001",{expected:"sign_in_failed"});
   assert((await request(invalid.context,"/api/state")).status===401,"A mismatched signed nonce cannot create an application session.");
   await invalid.context.close();
  }finally{await control("valid");}
  const reopened=await persona("native-staff-001");assert((await api(reopened.context,"/api/state")).actor.role==="auditor","A fresh valid provider transaction must recover ordinary sign-in.");
  await logout(reopened);
  return{overlap_mapping_id:overlap.id,corrected_mapping_revision:overlap.revision,overlap_reviewed:true,mismatched_nonce_rejected:true,fresh_valid_sign_in:true};
 });
 await phase("named-access-review-history-and-complete-operator-views",async()=>{
  await identityPage();await tab("reviews");
  let review=(await state()).attestations.find(r=>r.payload.reviewer_reference==="practice-access-review-"+journal.run_id);
  if(!review){
   await owner.locator('[data-identity-action="new-review"]').click();
   await fill(owner,{"#ip-review-name":"Practice receiving access reviewer","#ip-review-reference":"practice-access-review-"+journal.run_id,
    "#ip-review-note":"Reviewed original source-bound HTTPS registration, eight audit roles, unit delegation, pending account decision and actual device closure.",
    "#ip-review-exceptions":"Production receiving owner records the actual institutional registration, attributes and operating approvals against this retained plan."});
   await owner.locator("#ip-review-outcome").selectOption("approved");
   review=(await submit(owner,"identity.attestation.save")).value.record;
  }
  const current=(await state()).attestations.find(r=>r.id===review.id);
  assert(current.payload.current_configuration,"The named review must refer to the saved current access basis.");
  await tab("accounts");
  const unit=(await state()).accounts.find(r=>r.payload.subject==="umich-practice-unit");
  await owner.locator('[data-identity-action="history"][data-kind="identity_account"][data-id="'+unit.id+'"]').click();
  await owner.locator("#ip-history-comparison").waitFor();
  assert((await owner.locator("#ip-history-comparison").innerText()).length>20,"The account's original lifecycle editions must be readable.");
  await owner.locator("#close-dialog").click();
  const views=[];
  for(const name of ["overview","providers","mappings","accounts","delegations","sessions","reviews","source"]){await tab(name);const g=await owner.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert(g.scroll<=g.client+1,name+" must fit the desktop operator.");views.push(name);}
  await tab("accounts");const desktop=await capture(owner,"institutional-accounts-desktop.png");
  await owner.setViewportSize({width:390,height:844});
  for(const name of ["overview","providers","accounts","sessions","reviews","source"]){await tab(name);const g=await owner.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert(g.scroll<=g.client+1,name+" must fit the 390px operator.");}
  await tab("accounts");const mobile=await capture(owner,"institutional-accounts-mobile.png");
  const tableGeometry=await owner.locator(".ip-table-wrap").first().evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth,overflow:getComputedStyle(e).overflowX}));
  assert(tableGeometry.scroll>=tableGeometry.client&&["auto","scroll"].includes(tableGeometry.overflow),"Wide original account tables must scroll within the mobile page.");
  await owner.setViewportSize({width:1440,height:1050});await tab("source");
  const downloadPromise=owner.waitForEvent("download");
  await owner.locator('[data-identity-action="export"]').click();const download=await downloadPromise;
  const exportPath=path.join(root,"Institutional_Access_Review_Before_Receiving.json");await download.saveAs(exportPath);
  const exported=JSON.parse(fs.readFileSync(exportPath));assert(exported.schema==="commons-audit-institutional-access-review/1"&&exported.state.accounts.length>=9,"The downloaded review must contain the complete saved account history.");
  journal.review_id=review.id;save();
  return{review_id:review.id,basis_sha256:review.payload.basis_sha256,desktop,mobile,mobile_table:tableGeometry,desktop_views:views,review_export:fileIdentity(exportPath)};
 });
 await phase("same-service-restart-and-original-audit-retention",async()=>{
  const before=await bridge("inspect",{workspace});
  await bridge("restart");
  await owner.reload({waitUntil:"domcontentloaded"});await owner.locator("#shell").waitFor({state:"visible"});
  await identityPage();
  const after=await bridge("inspect",{workspace});
  assert(before.domain_sha256===after.domain_sha256&&before.identity_sha256===after.identity_sha256,"Restart must preserve the exact audit and institutional editions.");
  assert(before.selection_sha256===after.selection_sha256,"Ordinary session activity must preserve the original reviewed audit selection.");
  assert((await state()).attestations.some(r=>r.id===journal.review_id&&r.payload.current_configuration),"The exact named review must reopen after server restart.");
  return{original_audit:after,origin:ready.origin,original_session_reopened:true,retained_identity_sha256:after.identity_sha256};
 });
 await phase("original-encrypted-backup-and-fresh-owner-receiving",async()=>{
  const before=await bridge("inspect",{workspace});
  const saved=await encryptedBackup("Practice institutional receiving handover "+journal.run_id,"Audit_Institutional_Before_Receiving.cab");
  journal.receiving_backup=saved.artifact;journal.receiving_backup_id=saved.record.id;save();
  const name="institutional-received-"+journal.run_id.slice(0,8);
  let receiving=await bridge("open_received",{directory_name:name,backup_sha256:saved.artifact.sha256});
  let old_session_rejected;
  if(!receiving.exists){
   await mainRoute(owner,"Backup & recovery","Backup & recovery");
   await owner.locator("#restore-artifact").selectOption(saved.record.id);
   await fill(owner,{"#restore-pass":privateState.backup_passphrase,"#restore-name":name});
   const response=await actionResponse(owner,"restore",()=>owner.getByRole("button",{name:"Restore and open a new workspace",exact:true}).click());
   assert(response.status===200&&response.value.access_renewed,"The complete original encrypted archive must restore through the owning interface.");
   const receivingURL=new URL(response.value.access_link),key=receivingURL.searchParams.get("workspace");
   old_session_rejected=(await request(ownerContext,"/api/state",{},undefined,key)).status===401;
   assert(old_session_rejected,"The original browser session cannot select the fresh receiving workspace.");
   const popupPromise=owner.waitForEvent("popup");
   await owner.locator("#restore-result").getByRole("link",{name:"Open the restored workspace",exact:true}).click();
   const restoredPage=watch(await popupPromise);await restoredPage.locator("#shell").waitFor({state:"visible"});
   await owner.close();owner=restoredPage;
   receiving={exists:true,workspace:key,directory:response.value.directory,url:ready.origin+"/?"+new URLSearchParams({workspace:key}),owner_key_file:path.join(response.value.directory,"operator.key"),backup_sha256:saved.artifact.sha256};
  } else {
   old_session_rejected=(await request(ownerContext,"/api/state",{},undefined,receiving.workspace)).status===401;
   await signInOwner(owner,receiving.workspace,receiving.owner_key_file);
  }
  journal.received=receiving;save();workspace=receiving.workspace;
  const ip=await state(), after=await bridge("inspect",{workspace});
  assert(ip.provider_options.every(p=>!p.enabled),"The receiving epoch must require explicit provider reactivation.");
  assert(ip.delegations.every(r=>r.payload.epoch!==ip.identity_epoch),"Original delegations must await receiving-owner renewal.");
  assert(before.domain_sha256===after.domain_sha256,"Complete original audit records and revisions must survive the encrypted receiving.");
  const originalRows=new Map(before.identity_revision_rows.map(r=>[r.kind+"|"+r.id+"|"+r.revision,r.sha256]));
  const receivedRows=new Map(after.identity_revision_rows.map(r=>[r.kind+"|"+r.id+"|"+r.revision,r.sha256]));
  assert([...originalRows].every(([k,v])=>receivedRows.get(k)===v),"The complete retained institutional editions must survive restoration.");
  assert(after.transient_counts.identity_logins===0,"Restoration must clear in-flight provider logins.");
  await identityPage();await tab("providers");
  const screenshot=await capture(owner,"institutional-fresh-receiving.png");
  return{backup:saved.artifact,receiving:{workspace_id:after.workspace_id,directory:receiving.directory,workspace_key:workspace},
   old_session_rejected,providers_require_review:true,delegations_require_renewal:true,
   original_audit:after,retained_identity_revisions:originalRows.size,screenshot};
 });
 if(journal.received){
  workspace=journal.received.workspace;
  if(new URL(owner.url()).searchParams.get("workspace")!==workspace)await signInOwner(owner,workspace,journal.received.owner_key_file);
 }
 await phase("receiving-registration-renewal-and-complete-final-export",async()=>{
  await bridge("register_callback",{workspace,provider_id:journal.provider_id});
  let r=await providerRecord();
  const expectedCallback=ready.origin+"/api/identity/callback?"+new URLSearchParams({workspace,provider:journal.provider_id});
  if(r.payload.configuration.redirect_uri!==expectedCallback){
   await identityPage();await tab("providers");
   await owner.locator('[data-identity-action="provider"][data-id="'+journal.provider_id+'"]').click();
   assert(await owner.locator("#ip-provider-callback").inputValue()===expectedCallback,"The receiving form must use its own exact workspace callback.");
   await owner.locator("#ip-provider-change").fill("Practice receiving owner registers this new workspace callback while preserving the original issuer and subject assignments.");
   r=(await submit(owner,"identity.provider.save")).value.record;
  }
  if(!r.payload.metadata)r=await inspectProvider();
  await activateProvider();
  let ip=await state(),delegation=ip.delegations.find(r=>r.id===journal.delegation_id);
  assert(delegation,"The original named delegation is retained for receiving review.");
  if(delegation.payload.epoch!==ip.identity_epoch){
   await identityPage();await tab("delegations");
   await owner.locator('[data-identity-action="delegation"][data-id="'+delegation.id+'"]').click();
   await owner.locator("#ip-delegation-active").check();
   await owner.locator("#ip-delegation-note").fill("Practice receiving owner renews the original explicit role/unit administration on this restored workspace.");
   delegation=(await submit(owner,"identity.delegation.save")).value.record;
  }
  const pair=await persona("umich-practice-unit");
  const reopened=await state(pair.context);
  assert(reopened.capabilities.can_administer&&reopened.capabilities.units_by_role.unit_leadership.includes(unitA),"The receiving owner must be able to renew the same original delegated administrator.");
  assert((await api(pair.context,"/api/state")).actor.id===journal.role_accounts.find(r=>r.role==="unit_leadership").id,"Issuer/subject account identity must remain stable after receiving.");
  await identityPage(pair.page);await tab("accounts",pair.page);
  const mobileBefore=pair.page.viewportSize();await pair.page.setViewportSize({width:390,height:844});
  const screenshot=await capture(pair.page,"institutional-reopened-delegate-mobile.png");
  await pair.page.setViewportSize(mobileBefore);await logout(pair);
  await identityPage();await tab("reviews");
  let receivingReview=(await state()).attestations.find(r=>r.payload.reviewer_reference==="practice-receiving-review-"+journal.run_id);
  if(!receivingReview){
   await owner.locator('[data-identity-action="new-review"]').click();
   await fill(owner,{"#ip-review-name":"Practice receiving owner","#ip-review-reference":"practice-receiving-review-"+journal.run_id,
    "#ip-review-note":"Reviewed the received original issuer/subject account history, renewed exact callback, original eight roles and explicit unit delegation.",
    "#ip-review-exceptions":"The receiving registration and owner attestations are recorded as a private operated example; the intended institution configures its actually issued registration."});
   await owner.locator("#ip-review-outcome").selectOption("approved");
   receivingReview=(await submit(owner,"identity.attestation.save")).value.record;
  }
  ip=await state();assert(ip.attestations.some(r=>r.id===receivingReview.id&&r.payload.current_configuration),"The new receiving review must bind its actual renewed configuration.");
  assert(ip.attestations.some(r=>r.id===journal.review_id&&!r.payload.current_configuration),"The original review must retain its earlier configuration after the receiving edition changes.");
  await tab("source");
  const pendingDownload=owner.waitForEvent("download");await owner.locator('[data-identity-action="export"]').click();
  const download=await pendingDownload;const exportPath=path.join(root,"Institutional_Access_Complete_Review.json");await download.saveAs(exportPath);
  const exported=JSON.parse(fs.readFileSync(exportPath));assert(exported.state.accounts.length===ip.accounts.length,"The final exported review must match the current complete account desk.");
  const finalBackup=await encryptedBackup("Practice complete institutional receiving "+journal.run_id,"Audit_Institutional_Complete_Workspace.cab");
  const after=await bridge("inspect",{workspace});
  journal.final_backup=finalBackup.artifact;journal.final_review=fileIdentity(exportPath);save();
  return{provider_id:journal.provider_id,callback:expectedCallback,delegation_id:delegation.id,
   receiving_review_id:receivingReview.id,receiving_basis_sha256:receivingReview.payload.basis_sha256,
   accounts:ip.accounts.length,providers:ip.providers.length,mappings:ip.rules.length,
   complete_review:fileIdentity(exportPath),complete_backup:finalBackup.artifact,reopened_mobile:screenshot,original_audit:after};
 });
 assert(errors.length===0,"The original browser must finish without JavaScript errors: "+errors.join("; "));
 journal.browser_errors=errors;journal.status="COMPLETE";journal.completed_at=new Date().toISOString();journal.active_phase=null;save();
 await bridge("complete",{workspace});
 console.log("UMICH_STAGE "+JSON.stringify({stage:"institutional_browser_complete",status:"completed"}));
} catch(error) {
 journal.status="CONTINUATION_REQUIRED";
 journal.last_error={type:error.name,message:String(error.message).replace(/([?&](?:code|state|token|access)=)[^&\s"']+/gi,"$1[retained privately]")};
 journal.browser_errors=errors;save();console.error(error.stack);process.exitCode=1;
} finally {
 for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error("The original browser closed."));}
 pending.clear();
 if(browser)await browser.close();
 input.close();
 process.stdin.pause();
 process.stdin.unref?.();
}
