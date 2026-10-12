// MIT. Operate the maintained carbon desks through their native browser controls.
// All writes below submit the original application forms. Clients and HTTP fetches are readback only.
import {mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const need=(value,message)=>{if(!value)throw new Error(message);return value;};
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const attr=(name,value)=>'['+name+'='+JSON.stringify(String(value))+']';
const action=(name,id)=>'[data-action="'+name+'"]'+(id===undefined?'':attr('data-id',id));
const same=(left,right,label)=>need(canonical(left)===canonical(right),label);
const monthOf=value=>{
  const day=String(value).slice(0,10);need(/^\d{4}-\d{2}-\d{2}$/.test(day),'The original contribution needs its original civil date.');
  const fromDate=day.slice(0,7)+'-01',year=Number(day.slice(0,4)),month=Number(day.slice(5,7));
  return {fromDate,beforeDate:String(month===12?year+1:year).padStart(4,'0')+'-'+String(month===12?1:month+1).padStart(2,'0')+'-01'};
};
const amountText=(atoms,decimals)=>{
  const d=Number(decimals);need(Number.isInteger(d)&&d>=0&&d<=100,'Keep the original token precision.');
  const value=BigInt(atoms),negative=value<0n,body=(negative?-value:value).toString().padStart(d+1,'0');
  return (negative?'-':'')+(d?body.slice(0,-d)+'.'+body.slice(-d):body);
};
const originalAmountMatches=(value,payment)=>{
  if(!/^\d+(?:\.\d+)?$/.test(String(value)))return false;
  const d=Number(payment.asset.decimals),[whole,fraction='']=String(value).split('.'),trimmed=fraction.replace(/0+$/,'');
  return trimmed.length<=d&&BigInt(whole+trimmed.padEnd(d,'0'))===BigInt(payment.amountAtoms);
};
const transactionFor=(source,hash)=>{
  const key=String(hash||'').toLowerCase(),rows=source?.tables?.transactions||[];
  return rows.find(row=>row.hash===key)||rows.find(row=>row.successful===true&&(row.hashAliases||[]).includes(key))||
    rows.find(row=>(row.hashAliases||[]).includes(key));
};

/**
 * browser: {open,evaluate,until,image,command,sessionCommand,events}
 * command and sessionCommand return the native CDP result. events retain {method,params}.
 * carbon: {url,client,currentSource,priorSource}; both sources are complete original edition objects.
 * give: {url,client,ledger,currentCarbonId,priorCarbonId,statementId}; ledger is the complete imported edition.
 * save(relativePath,UTF8TextOrJSON) is the native caller's immutable artifact writer.
 * Returned carbonReceived and giveReceived are existing child-server startup metadata, for the caller to close/reopen.
 */
export async function operateCarbonBrowsers({browser,carbon,give,output,save,actor='Local operator'}){
  need(browser?.command&&browser?.sessionCommand&&Array.isArray(browser.events),'The native Chromium CDP commands and event stream are required.');
  need(carbon?.currentSource?.id&&carbon?.priorSource?.id&&give?.ledger?.id&&give?.statementId,'Receive both complete source editions and the actual ledger before operating the browser.');
  const root=resolve(output),downloadDirectory=join(root,'browser-downloads');
  await mkdir(downloadDirectory,{mode:0o700});
  await browser.command('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:downloadDirectory,eventsEnabled:true});
  const result={schema:'stellar-forge.carbon-browser-actions.v1',startedAt:new Date().toISOString(),actor,
    originalURLs:{stellarcarbon:carbon.url,givecredit:give.url},actions:[],downloads:[],screenshots:[],received:{}};
  const expression=(fn,...args)=>'('+fn.toString()+')(...'+JSON.stringify(args)+')';
  const evaluate=(fn,...args)=>browser.evaluate(expression(fn,...args));
  const errorExpression="Array.from(document.querySelectorAll('#notice.error,#notice .error,#dialog-notice.error')).map(node=>node.textContent.trim()).filter(Boolean).join('\\n')";
  const mainChanged="window.__carbonNativeMain !== document.querySelector('#main')?.firstElementChild";
  async function mark(){
    await evaluate(()=>{window.__carbonNativeMain=document.querySelector('#main')?.firstElementChild;});
  }
  async function ready(condition,label){
    try{await browser.until('Boolean(('+errorExpression+') || ('+condition+'))');}
    catch(error){const observed=await evaluate(()=>({url:location.href,heading:document.querySelector('#main h1,#main h2')?.textContent,
      notice:document.querySelector('#notice')?.textContent,dialog:document.querySelector('#dialog-title')?.textContent}));
      throw new Error(label+': '+error.message+'; browser state '+JSON.stringify(observed));}
    const failure=await browser.evaluate(errorExpression);need(!failure,label+': '+failure);
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  async function click(selector){
    const value=await browser.sessionCommand('Runtime.evaluate',{expression:expression(selector=>{
      const node=document.querySelector(selector);if(!node)throw new Error('Original control is missing: '+selector);
      if(node.disabled)throw new Error('Original control is disabled: '+selector);
      node.scrollIntoView({block:'center'});node.click();return true;
    },selector),awaitPromise:true,returnByValue:true,userGesture:true});
    need(!value.exceptionDetails,'The original browser control failed: '+selector+' '+JSON.stringify(value.exceptionDetails||''));
  }
  async function fill(selector,fields){
    await evaluate((selector,fields)=>{
      const form=document.querySelector(selector);if(!form)throw new Error('Original form is missing: '+selector);
      for(const [name,value] of Object.entries(fields)){
        const node=form.elements.namedItem(name);if(!node)throw new Error('Original field is missing: '+name);
        if(node.type==='file')throw new Error('Use the native file picker for original files.');
        if(node.type==='checkbox')node.checked=Boolean(value);else node.value=String(value??'');
        node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));
        if(node.type!=='checkbox'&&node.value!==String(value??''))throw new Error('Original field did not accept '+name);
      }
    },selector,fields);
  }
  async function change(selector,value){
    await evaluate((selector,value)=>{const node=document.querySelector(selector);if(!node)throw new Error('Original selection is missing: '+selector);
      node.value=String(value);if(node.value!==String(value))throw new Error('The source selection is unavailable: '+value);
      node.dispatchEvent(new Event('change',{bubbles:true}));},selector,value);
  }
  async function submit(selector,submitter){
    await evaluate((selector,submitter)=>{
      const form=document.querySelector(selector);if(!form)throw new Error('Original form is missing: '+selector);
      if(!form.reportValidity())throw new Error('The original form requires '+[...form.elements].filter(node=>node.validity&&!node.validity.valid).map(node=>node.name+': '+node.validationMessage).join('; '));
      const button=submitter?form.querySelector(submitter):form.querySelector('button[type="submit"],button:not([type]),input[type="submit"]');
      if(!button||button.disabled)throw new Error('The original submit control is unavailable.');
      form.requestSubmit(button);
    },selector,submitter||null);
  }
  async function fileInput(selector,path){
    const document=await browser.sessionCommand('DOM.getDocument',{depth:1});
    const {nodeId}=await browser.sessionCommand('DOM.querySelector',{nodeId:document.root.nodeId,selector});
    need(nodeId,'The original file input is missing: '+selector);
    await browser.sessionCommand('DOM.setFileInputFiles',{nodeId,files:[path]});
    await ready(expression(selector=>document.querySelector(selector)?.files?.length===1,selector),'Select the original native file');
  }
  async function download(selector,relativePath){
    const offset=browser.events.length;
    const requested=await evaluate(selector=>{const node=document.querySelector(selector);if(!node)throw new Error('Original export control is missing: '+selector);
      return {url:node.href||null,label:node.textContent.trim(),download:node.download||null};},selector);
    await click(selector);
    let started,completed;
    for(let attempt=0;attempt<240;attempt++){
      const events=browser.events.slice(offset);
      started=events.find(row=>row.method==='Browser.downloadWillBegin');
      if(started){const guid=started.params.guid;
        const progress=events.filter(row=>row.method==='Browser.downloadProgress'&&row.params.guid===guid);
        const canceled=progress.find(row=>row.params.state==='canceled');need(!canceled,'Chromium canceled the original export: '+relativePath);
        completed=progress.find(row=>row.params.state==='completed');if(completed)break;}
      const failure=await browser.evaluate(errorExpression);need(!failure,'Original export failed: '+failure);await delay(125);
    }
    need(started&&completed,'Chromium did not complete the original export: '+relativePath);
    need(/^[a-z0-9-]+$/i.test(started.params.guid),'Keep Chromium download identifiers inside the private receiving directory.');
    const nativePath=join(downloadDirectory,started.params.guid),bytes=await readFile(nativePath);
    if(completed.params.totalBytes!==undefined)need(bytes.length===Number(completed.params.totalBytes),'The browser download is incomplete: '+relativePath);
    const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    need(Buffer.from(content).equals(bytes),'Preserve the complete UTF-8 original export.');
    await save(relativePath,content);
    const record={path:relativePath,nativePath,bytes:bytes.length,sha256:digest(bytes),requested,
      suggestedFilename:started.params.suggestedFilename,url:started.params.url,guid:started.params.guid};
    result.downloads.push(record);return {...record,content};
  }
  async function image(name){
    await browser.image(name);result.screenshots.push(name);
  }
  async function step(name,work){
    const record={name,startedAt:new Date().toISOString()};result.actions.push(record);
    const value=await work();Object.assign(record,{completedAt:new Date().toISOString(),result:value});
    await save('browser-actions/actions/'+String(result.actions.length).padStart(2,'0')+'.json',record);return value;
  }
  async function carbonNav(tab){
    await evaluate(()=>{const node=document.querySelector('#dialog');if(node?.open)document.querySelector('#close-dialog').click();});
    await mark();await click('#navigation [data-tab="'+tab+'"]');
    await ready(mainChanged+' && document.querySelector('+JSON.stringify('#navigation [data-tab="'+tab+'"]')+')?.getAttribute("aria-current")==="page"','Open Stellarcarbon '+tab);
  }
  async function giveNav(page){
    await mark();await click('nav [data-page="'+page+'"]');
    await ready(mainChanged+' && document.querySelector('+JSON.stringify('nav [data-page="'+page+'"]')+')?.getAttribute("aria-current")==="page"','Open GiveCredit '+page);
  }
  async function carbonRecord(selector,fields,expectedMessage){
    const before=await carbon.client.state();await fill(selector,fields);await mark();await submit(selector);
    await ready('!document.querySelector("#dialog")?.open && '+mainChanged+' && Number(document.querySelector("#revision")?.textContent.replace(/\\D/g,""))>'+before.revision+
      ' && document.querySelector("#notice")?.textContent.includes('+JSON.stringify(expectedMessage)+')','Save the original Stellarcarbon form');
    return carbon.client.state();
  }
  async function readJSON(url){
    const response=await fetch(url,{headers:{Accept:'application/json'}});need(response.ok,'Native readback failed: '+response.status+' '+url);return response.json();
  }
  async function startup(url,directory){
    const value=await readJSON(new URL('/api/health',url));need(resolve(value.directory)===resolve(directory),'The received server opened the wrong original directory.');
    return {...value,url};
  }

  let carbonReceived,giveReceived,customer,project,assignment,sourceTransaction,carbonStatementId,carbonStatementV1,giveV1;
  try{
    const originalCarbon=await carbon.client.state();
    const originalCurrent=carbon.currentSource,originalPrior=carbon.priorSource;
    const immutableCarbon=await carbon.client.statement('statement-november-2025',2);
    const references=new Set(originalCarbon.customers.map(row=>row.reference));
    sourceTransaction=originalCurrent.tables.sinking_txs.find(row=>row.recipient&&!references.has(row.recipient)&&
      !originalCarbon.assignments.some(link=>link.active!==false&&link.kind==='TRANSACTION'&&link.value===row.hash));
    need(sourceTransaction,'Select an actual unassigned recipient contribution for the complete customer intake.');
    const sourceBefore=await carbon.client.contribution(sourceTransaction.hash,{editionId:originalCurrent.id});
    need(!sourceBefore.assignment.customerId,'The chosen original contribution already belongs to an operator customer.');
    const month=monthOf(sourceTransaction.created_at),sourceNote='Original recipient '+sourceTransaction.recipient+
      '; contribution '+sourceTransaction.hash+'; source edition '+originalCurrent.id+'.';
    await browser.open(carbon.url);
    await ready('Boolean(document.querySelector("#revision")?.textContent.match(/\\d/))','Open the native Stellarcarbon workspace');
    await evaluate(actor=>{const node=document.querySelector('#operator');node.value=actor;node.dispatchEvent(new Event('input',{bubbles:true}));},actor);
    if(await evaluate(id=>document.querySelector('#edition').value!==id,originalCurrent.id)){
      await mark();await change('#edition',originalCurrent.id);await ready(mainChanged,'Select the retained current source edition');
    }
    await mark();await click('#clear-filters');await ready(mainChanged,'Clear the original portfolio selection');

    await step('Create and edit a customer and project from an original recipient and transaction memo',async()=>{
      await carbonNav('customers');await click(action('new-customer'));
      await ready('document.querySelector("#dialog")?.open && Boolean(document.querySelector("#customer-form"))','Open customer intake');
      let state=await carbonRecord('#customer-form',{name:'Recorded recipient '+sourceTransaction.recipient.slice(0,4)+'…'+sourceTransaction.recipient.slice(-5),
        reference:sourceTransaction.recipient,note:sourceNote},'Saved customer.');
      customer=state.customers.find(row=>row.reference===sourceTransaction.recipient);need(customer,'The source-derived customer was not saved.');
      await click(action('edit-customer',customer.id));
      await ready('Boolean(document.querySelector("#customer-form")?.dataset.id==='+JSON.stringify(customer.id)+')','Open the saved customer');
      state=await carbonRecord('#customer-form',{note:sourceNote+' Prepared by '+actor+' through the native browser.'},'Saved customer.');
      customer=state.customers.find(row=>row.id===customer.id);need(customer.version===2,'The customer edit did not retain its original revision.');
      await click(action('new-project'));await ready('Boolean(document.querySelector("#project-form"))','Open original customer project intake');
      const projectName=String(sourceTransaction.memo_value||'Contribution '+sourceTransaction.created_at.slice(0,10)).slice(0,300);
      state=await carbonRecord('#project-form',{customerId:customer.id,name:projectName,reference:sourceTransaction.hash,
        note:'Project label follows the original transaction memo. '+sourceNote},'Saved project.');
      project=state.projects.find(row=>row.customerId===customer.id&&row.reference===sourceTransaction.hash);need(project,'The source-derived project was not saved.');
      await click(action('edit-project',project.id));await ready('Boolean(document.querySelector("#project-form")?.dataset.id==='+JSON.stringify(project.id)+')','Open the saved source project');
      state=await carbonRecord('#project-form',{note:'Original transaction memo retained verbatim; the project covers this source-linked contribution. '+sourceNote},'Saved project.');
      project=state.projects.find(row=>row.id===project.id);need(project.version===2,'The original project edit did not persist.');
      await image('stellarcarbon-browser-customer-project.png');
      return {customer,project,originalRecipient:sourceTransaction.recipient,originalHash:sourceTransaction.hash};
    });

    await step('Assign the original transaction through its contribution detail and edit that mapping',async()=>{
      await carbonNav('contributions');await fill('#contribution-filter',{search:sourceTransaction.hash});await mark();await submit('#contribution-filter');
      await ready(mainChanged+' && Boolean(document.querySelector('+JSON.stringify(action('contribution',sourceTransaction.hash))+'))','Find the original contribution');
      await click(action('contribution',sourceTransaction.hash));
      await ready('document.querySelector("#dialog")?.open && document.querySelector("#dialog-body")?.textContent.includes('+JSON.stringify(sourceTransaction.toid)+')','Open the original contribution and TOID');
      await click(action('assign-source',sourceTransaction.hash)+'[data-kind="TRANSACTION"]');
      await ready('Boolean(document.querySelector("#assignment-form"))','Assign the exact original transaction');
      let state=await carbonRecord('#assignment-form',{kind:'TRANSACTION',value:sourceTransaction.hash,customerId:customer.id,projectId:project.id,
        note:'Exact original transaction assignment. '+sourceNote,active:true},'Saved assignment.');
      assignment=state.assignments.find(row=>row.kind==='TRANSACTION'&&row.value===sourceTransaction.hash&&row.customerId===customer.id);
      need(assignment,'The exact source assignment did not persist.');
      await carbonNav('assignments');await click(action('edit-assignment',assignment.id));
      await ready('Boolean(document.querySelector("#assignment-form")?.dataset.id==='+JSON.stringify(assignment.id)+')','Reopen the saved transaction assignment');
      state=await carbonRecord('#assignment-form',{note:'Exact transaction assignment reviewed against the original recipient, memo, TOID and CARBON amount. '+sourceNote},'Saved assignment.');
      assignment=state.assignments.find(row=>row.id===assignment.id);need(assignment.version===2,'The source assignment edit did not retain its revision.');
      const detail=await carbon.client.contribution(sourceTransaction.hash,{editionId:originalCurrent.id});
      need(detail.assignment.customerId===customer.id&&detail.assignment.projectId===project.id,'The original contribution did not resolve to the saved customer and project.');
      for(const key of ['hash','toid','recipient','funder','created_at','carbon_amount'])same(detail[key],sourceBefore[key],'The operator mapping changed original '+key);
      await save('browser-actions/stellarcarbon-original-contribution.json',detail);
      return {assignment,sourceHash:detail.hash,originalTOID:detail.toid,carbon:detail.carbon_amount};
    });

    await step('Preview, save, revise and export a statement through the native customer form',async()=>{
      await carbonNav('statements');await click(action('new-statement'));await ready('Boolean(document.querySelector("#statement-form"))','Open the period statement form');
      const title=project.name+' · '+month.fromDate.slice(0,7);
      await fill('#statement-form',{title,editionId:originalCurrent.id,customerId:customer.id,projectId:project.id,...month,
        note:'Source-linked customer statement prepared from the original contribution. '+sourceNote});
      await click(action('preview-statement'));
      await ready('Boolean(document.querySelector("#statement-preview .editor-preview"))','Preview the source-derived statement');
      await image('stellarcarbon-browser-statement-preview.png');
      const before=await carbon.client.state();await mark();await submit('#statement-form');
      await ready('document.querySelector("#dialog")?.open && !document.querySelector("#statement-form") && Boolean(document.querySelector("#dialog-body a[href*=\\"/files/\\"]")) && Number(document.querySelector("#revision")?.textContent.replace(/\\D/g,""))>'+before.revision,'Save the first complete statement version');
      let state=await carbon.client.state();
      const saved=state.statements.find(row=>!before.statements.some(old=>old.id===row.id));need(saved,'The browser did not create a saved statement.');
      carbonStatementId=saved.id;carbonStatementV1=await carbon.client.statement(saved.id,1);
      need(carbonStatementV1.contributions.some(row=>row.hash===sourceTransaction.hash),'The saved statement omitted the original selected contribution.');
      need(carbonStatementV1.spec.customerId===customer.id&&carbonStatementV1.spec.projectId===project.id,'The statement lost its operator customer selection.');
      const oldFile=await download('#dialog-body a[href*="/files/statement.json"]','browser-actions/stellarcarbon/statement-v1.json');
      same(JSON.parse(oldFile.content).totals,carbonStatementV1.totals,'The downloaded original statement totals changed.');
      await click(action('revise-statement',saved.id));await ready('Boolean(document.querySelector("#statement-form")?.dataset.id==='+JSON.stringify(saved.id)+')','Revise the saved statement');
      await fill('#statement-form',{note:'Reviewed recipient, project and exact original allocation records. '+sourceNote});
      await submit('#statement-form');
      await ready('!document.querySelector("#statement-form") && document.querySelector("#dialog-title")?.textContent.endsWith("version 2")','Save the revised complete statement');
      const report=await carbon.client.statement(saved.id,2);same(report.totals,carbonStatementV1.totals,'An operator note changed original statement quantities.');
      same(await carbon.client.statement(saved.id,1),carbonStatementV1,'The original saved statement version was overwritten.');
      for(const filename of ['statement.html','statement.json','contributions.csv','allocations.csv','retirements.csv'])
        await download('#dialog-body a[href*='+JSON.stringify('/files/'+filename)+']','browser-actions/stellarcarbon/version-2/'+filename);
      await image('stellarcarbon-browser-statement-v2.png');
      state=await carbon.client.state();need(state.statements.find(row=>row.id===saved.id).versions.length===2,'Both immutable statement versions must remain available.');
      return {statementId:saved.id,versions:2,period:month,totals:report.totals,retirementTotals:report.retirementTotals};
    });

    await step('Operate original source comparison and retain its complete browser exports',async()=>{
      await carbonNav('compare');await fill('#compare-form',{beforeId:originalPrior.id,afterId:originalCurrent.id});await submit('#compare-form');
      await ready('Boolean(document.querySelector("#comparison-result [data-action=\\"compare-table\\"]"))','Compare both complete source editions');
      await click(action('compare-table','distribution_txs'));
      await ready('document.querySelector("#comparison-result")?.textContent.includes("Comparison unavailable")','Keep an unacquired source table unavailable');
      const comparison=await carbon.client.compare(originalPrior.id,originalCurrent.id);
      need(comparison.tables.distribution_txs.comparisonStatus==='unavailable'&&comparison.tables.minted_blocks.comparisonStatus==='unavailable','The original API coverage changed.');
      const csv=await download('#comparison-result a[href*="format=csv"]','browser-actions/stellarcarbon/source-comparison.csv');
      const json=await download(action('download-comparison'),'browser-actions/stellarcarbon/source-comparison.json');
      same(JSON.parse(json.content),comparison,'The browser comparison download differs from the native comparison.');
      await image('stellarcarbon-browser-source-comparison.png');
      return {before:originalPrior.id,after:originalCurrent.id,csvSha256:csv.sha256,jsonSha256:json.sha256};
    });

    await step('Receive the browser-exported Stellarcarbon workspace and make the next independent edit',async()=>{
      await carbonNav('capture');
      const handover=await download('#receive-form a[href="/api/handover"]','browser-actions/stellarcarbon/complete-handover.json');
      const full=JSON.parse(handover.content);
      same(full.workspace.editions.find(row=>row.id===originalCurrent.id),originalCurrent,'The native handover changed the complete current source.');
      same(full.workspace.editions.find(row=>row.id===originalPrior.id),originalPrior,'The native handover changed the complete original backup.');
      const directory=join(root,'stellarcarbon-browser-received');
      await fill('#receive-form',{directory});await fileInput('#receive-form input[name="handover"]',handover.nativePath);await submit('#receive-form');
      await ready('Boolean(document.querySelector("#receive-result a[href]"))','Receive the complete Stellarcarbon browser handover');
      const url=await evaluate(()=>document.querySelector('#receive-result a[href]').href);
      carbonReceived=await startup(url,directory);result.received.stellarcarbon=carbonReceived;
      const receivedClient=new carbon.client.constructor({baseUrl:new URL('/api',url).href});
      const originalCustomer=(await carbon.client.state()).customers.find(row=>row.id===customer.id);
      await browser.open(url,{mobile:true});await ready('Boolean(document.querySelector("#revision")?.textContent.match(/\\d/))','Open the independently received Stellarcarbon browser');
      await evaluate(actor=>{document.querySelector('#operator').value=actor;},actor);
      await carbonNav('customers');await click(action('edit-customer',customer.id));await ready('Boolean(document.querySelector("#customer-form"))','Reopen the received editable customer');
      const before=await receivedClient.state(),note=originalCustomer.note+' Independent receiving edit by '+actor+'.';
      await fill('#customer-form',{note});await mark();await submit('#customer-form');
      await ready('!document.querySelector("#dialog")?.open && '+mainChanged+' && Number(document.querySelector("#revision")?.textContent.replace(/\\D/g,""))>'+before.revision,'Save the next received customer edit');
      const after=await receivedClient.state();need(after.customers.find(row=>row.id===customer.id)?.note===note,'The independently received customer edit was not saved.');
      same((await carbon.client.state()).customers.find(row=>row.id===customer.id),originalCustomer,'The receiving edit changed the original customer workspace.');
      same(await receivedClient.statement(carbonStatementId,1),carbonStatementV1,'Receiving changed an original saved statement version.');
      await image('stellarcarbon-browser-received-mobile.png');
      await carbonNav('capture');const receivedFile=await download('#receive-form a[href="/api/handover"]','browser-actions/stellarcarbon/received-after-edit.json');
      const receivedFull=JSON.parse(receivedFile.content);
      need(receivedFull.workspace.customers.find(row=>row.id===customer.id)?.note===note,'The next editable state was omitted from the received export.');
      same(await carbon.client.statement('statement-november-2025',2),immutableCarbon,'The customer intake changed the original November statement.');
      return {...carbonReceived,customerId:customer.id,customerVersion:after.customers.find(row=>row.id===customer.id).version,
        statementId:carbonStatementId,retainedVersions:2,nextEditSaved:true};
    });

    await browser.open(give.url);
    await ready('Boolean(document.querySelector("#sources select[data-source=\\"ledger\\"]"))','Open the native GiveCredit source selections');
    async function giveSource(kind,id){
      if(await evaluate((kind,id)=>document.querySelector('select[data-source="'+kind+'"]')?.value!==id,kind,id)){
        await mark();await change('select[data-source="'+kind+'"]',id);
        await ready(mainChanged,'Select the original GiveCredit '+kind+' edition');
      }
    }
    await giveSource('ledger',give.ledger.id);await giveSource('carbon',give.currentCarbonId);
    let giveState=await give.client.state();
    const registryId=giveState.editions.filter(row=>row.kind==='registry').at(-1)?.id||'';
    await giveSource('registry',registryId);
    giveV1=await give.client.statement(give.statementId,1);

    await step('Open the actual ledger records, source-dated pools and complete source intake',async()=>{
      await giveNav('payments');
      const transfers=await give.client.transfers({editionId:give.ledger.id,limit:50});
      if(transfers.items.length){
        await click(action('transfer',transfers.items[0].key));
        await ready('document.querySelector("#main h1")?.textContent==="Original payment record"','Open an original ledger transfer');
        const detail=await give.client.transfer(transfers.items[0].key,{editionId:give.ledger.id});
        await save('browser-actions/givecredit/original-transfer.json',detail);await image('givecredit-browser-original-transfer.png');
      }
      await giveNav('pools');await ready('document.querySelector("#main h1")?.textContent==="Contract pools"','Open the original contract pool register');
      const pools=await give.client.pools({editionId:give.ledger.id});await save('browser-actions/givecredit/source-dated-pools.json',pools);
      await image('givecredit-browser-contract-pools.png');
      await giveNav('sources');await click(action('source',give.currentCarbonId));
      await ready('Boolean(document.querySelector("[data-source-table]"))','Open the complete actual carbon source edition');
      const source=await download('#main a[href*="/source"]','browser-actions/givecredit/current-carbon-source.json');
      const original=JSON.parse(source.content);need(original.id===give.currentCarbonId&&original.kind==='carbon','The browser exported the wrong original source.');
      await giveSource('carbon',give.priorCarbonId);
      await ready('document.querySelector("#main h1")?.textContent==="Original source editions"','Route a source change back to the original source collection');
      await giveSource('carbon',give.currentCarbonId);
      await giveNav('intake');await fill('form[data-form="source-import"]',{label:original.label,network:original.metadata.network});
      await fileInput('form[data-form="source-import"] input[name="sourceFile"]',source.nativePath);
      const before=await give.client.state();await submit('form[data-form="source-import"]');
      await ready('Boolean(document.querySelector("[data-source-table]")) && document.querySelector("#notice")?.textContent.includes("Complete original source edition imported.")','Receive the complete original source JSON through the browser');
      const after=await give.client.state();
      need(after.editions.length===before.editions.length,'An identical complete source edition should reuse its original identity.');
      need(after.editions.some(row=>row.id===original.id),'The original source identity disappeared during browser import.');
      return {ledgerEditionId:give.ledger.id,retainedTransferCount:transfers.total,poolCount:pools.pools.length,
        importedSourceId:original.id,sourceBytes:source.bytes,sourceSha256:source.sha256,sourceIdentityRetained:true};
    });

    await step('Review actual donation anchors and operate a source-resolved payment assignment when present',async()=>{
      await giveNav('donations');
      if(!registryId)return {registryEditionId:null,observedHeading:await evaluate(()=>document.querySelector('#main h1')?.textContent),
        availableSource:'Original ledger and complete Stellarcarbon editions are retained in this workspace.'};
      const originalRegistry=await give.client.request('editions/'+encodeURIComponent(registryId)+'/source');
      const before=await give.client.state(),saved=before.paymentLinks.find(row=>row.active!==false&&row.registryEditionId===registryId&&row.ledgerEditionId===give.ledger.id);
      let chosen,receipt,payment;
      if(saved){chosen=originalRegistry.tables.donations.find(row=>row.id===saved.donationId);payment=give.ledger.tables.transfers.find(row=>row.key===saved.paymentKey);}
      else{
        for(const candidate of originalRegistry.tables.donations){
          const anchors=originalRegistry.tables.nfts.filter(row=>row.donationId===candidate.id&&String(row.chainName||row.chain||'').toLowerCase()==='stellar'&&
            String(row.network||'').toLowerCase()===give.ledger.metadata.network);
          const matches=give.ledger.tables.transfers.filter(row=>row.from===candidate.wallet&&transactionFor(give.ledger,row.hash)?.successful===true&&
            String(candidate.asset||'').toUpperCase()===String(row.asset.code||'').toUpperCase()&&originalAmountMatches(candidate.amount,row)&&
            anchors.some(anchor=>transactionFor(give.ledger,anchor.transactionId)?.hash===transactionFor(give.ledger,row.hash)?.hash)&&
            !before.paymentLinks.some(link=>link.active!==false&&link.registryEditionId===registryId&&link.ledgerEditionId===give.ledger.id&&link.paymentKey===row.key));
          if(matches.length!==1)continue;
          const originals=anchors.filter(anchor=>transactionFor(give.ledger,anchor.transactionId)?.hash===transactionFor(give.ledger,matches[0].hash)?.hash);
          if(originals.length!==1)continue;chosen=candidate;payment=matches[0];receipt=originals[0];break;
        }
      }
      const originalDonation=chosen||originalRegistry.tables.donations[0];
      if(!originalDonation)return {registryEditionId:registryId,originalDonations:0};
      await fill('form[data-form="filter"][data-target="donations"]',{search:originalDonation.id});await mark();await submit('form[data-form="filter"][data-target="donations"]');
      await ready(mainChanged+' && Boolean(document.querySelector('+JSON.stringify(action('donation',originalDonation.id))+'))','Find the original registry donation');
      await click(action('donation',originalDonation.id));await ready('Boolean(document.querySelector("form[data-form=\\"payment-link\\"]"))','Open the original donation and ledger assignment form');
      const detail=await give.client.donation(originalDonation.id,{editionId:registryId,ledgerEditionId:give.ledger.id});
      await save('browser-actions/givecredit/original-donation.json',detail);
      if(!chosen||!payment){await image('givecredit-browser-original-donation.png');return {registryEditionId:registryId,donationId:originalDonation.id,
        originalReceipts:detail.receipts.length,originalPaymentCandidates:detail.candidatePayments.length,assignmentState:'Original anchors retained for operator selection'};}
      if(saved){
        await click(action('edit-link',saved.id));await ready('document.querySelector("form[data-form=\\"payment-link\\"] h2")?.textContent==="Edit payment assignment"','Open the retained original payment assignment');
      }
      const note=saved?saved.note+' Original source assignment reopened by '+actor+'.':
        'Exact original donation, direct receipt payment hash, network, payer, asset and amount. Receipt '+receipt.id+'; payment '+payment.hash+'.';
      await fill('form[data-form="payment-link"]',{paymentKey:payment.key,paymentAmount:amountText(saved?.amountAtoms||payment.amountAtoms,payment.asset.decimals),
        receiptId:saved?.receiptId||receipt?.id||'',note});
      await mark();await submit('form[data-form="payment-link"]');
      await ready(mainChanged+' && document.querySelector("#notice")?.textContent.includes("Payment assignment saved")','Save the original payment assignment');
      let state=await give.client.state(),link=saved?state.paymentLinks.find(row=>row.id===saved.id):
        state.paymentLinks.find(row=>row.donationId===chosen.id&&row.registryEditionId===registryId&&row.ledgerEditionId===give.ledger.id&&row.paymentKey===payment.key);
      need(link?.note===note,'The source-resolved payment assignment was not saved.');
      if(!saved){
        await click(action('edit-link',link.id));await ready('document.querySelector("form[data-form=\\"payment-link\\"] h2")?.textContent==="Edit payment assignment"','Reopen the saved source payment assignment');
        const reviewNote=note+' Source anchors reviewed by '+actor+'.';
        await fill('form[data-form="payment-link"]',{note:reviewNote});await mark();await submit('form[data-form="payment-link"]');
        await ready(mainChanged+' && document.querySelector("#notice")?.textContent.includes("Payment assignment saved")','Save the next original payment assignment revision');
        state=await give.client.state();link=state.paymentLinks.find(row=>row.id===link.id);need(link?.note===reviewNote&&link.version===2,'Both original payment mapping revisions must be retained.');
      }else need(link.version===saved.version+1,'The original payment mapping revision did not advance.');
      await image('givecredit-browser-payment-assignment.png');
      return {registryEditionId:registryId,paymentLink:link,originalDonationId:chosen.id,originalPaymentHash:payment.hash};
    });

    await step('Revise, preview and download every file from the native GiveCredit statement',async()=>{
      await giveNav('statements');await click(action('edit-statement',give.statementId));
      await ready('document.querySelector("form[data-form=\\"statement\\"] h2")?.textContent==="Issue a new statement version"','Open the saved GiveCredit statement selection');
      const before=await give.client.state(),saved=before.statements.find(row=>row.id===give.statementId),version=saved.versions+1;
      await fill('form[data-form="statement"]',{note:saved.latest.spec.note+' Original source selections reviewed in the native browser by '+actor+'.'});
      await mark();await submit('form[data-form="statement"]','button[name="intent"][value="preview"]');
      await ready(mainChanged+' && Boolean(document.querySelector("#main section.preview"))','Preview the native GiveCredit statement');
      await image('givecredit-browser-statement-preview.png');
      await submit('form[data-form="statement"]','button[name="intent"][value="save"]');
      await ready('document.querySelector("[data-statement-version]")?.value==='+JSON.stringify(String(version)),'Save the complete GiveCredit statement revision');
      const report=await give.client.statement(give.statementId,version);
      need(report.spec.basis===saved.latest.spec.basis&&report.spec.fromDate===saved.latest.spec.fromDate&&report.spec.beforeDate===saved.latest.spec.beforeDate,
        'The saved statement changed its original source date basis.');
      for(const filename of ['statement.html','statement.json','donations.csv','payments.csv','payout-funding.csv','carbon-contributions.csv','carbon-allocations.csv','retirement-register.csv','receipt-records.csv'])
        await download('#main a[href*='+JSON.stringify('/files/'+filename)+']','browser-actions/givecredit/version-'+version+'/'+filename);
      await image('givecredit-browser-statement-revision.png');
      await mark();await change('[data-statement-version]','1');await ready(mainChanged+' && document.querySelector("[data-statement-version]")?.value==="1"','Reopen the first immutable GiveCredit statement');
      const original=await download('#main a[href*="/files/statement.json"]','browser-actions/givecredit/statement-v1.json');
      same(JSON.parse(original.content).totals,giveV1.totals,'The original downloaded GiveCredit statement totals changed.');
      same(await give.client.statement(give.statementId,1),giveV1,'A later source or operator edit overwrote the first GiveCredit statement.');
      return {statementId:give.statementId,version,basis:report.spec.basis,fromDate:report.spec.fromDate,beforeDate:report.spec.beforeDate,totals:report.totals};
    });

    await step('Receive the browser-exported GiveCredit workspace, rename it and retain the next editable state',async()=>{
      await giveNav('intake');
      const file=await download('#handover-link','browser-actions/givecredit/complete-handover.json'),full=JSON.parse(file.content);
      const original=await give.client.state(),directory=join(root,'givecredit-browser-received');
      const source=full.workspace.editions.find(row=>row.id===give.ledger.id);
      same(source,give.ledger,'The browser handover changed the complete original ledger edition.');
      await fill('form[data-form="receive"]',{directory});await fileInput('form[data-form="receive"] input[name="handoverFile"]',file.nativePath);
      await submit('form[data-form="receive"]');
      await ready('document.querySelector("#notice")?.textContent.includes("Independent editable workspace received.") && Boolean(document.querySelector("#main section.panel a[target=\\"_blank\\"]"))','Receive the whole GiveCredit workspace through the original form');
      const url=await evaluate(()=>document.querySelector('#main section.panel a[target="_blank"]').href);
      giveReceived=await startup(url,directory);result.received.givecredit=giveReceived;
      need(giveReceived.workspaceId!==original.workspaceId,'The received GiveCredit workspace needs its independent identity.');
      const receivedClient=new give.client.constructor(url,{actor}),received=await receivedClient.state();
      await browser.open(url,{mobile:true});await ready('Boolean(document.querySelector("form[data-form=\\"settings\\"]"))','Open the independently received GiveCredit browser');
      const name=received.name+' · browser received by '+actor;
      await fill('form[data-form="settings"]',{name});await mark();await submit('form[data-form="settings"]');
      await ready(mainChanged+' && document.querySelector("#workspace-name")?.textContent==='+JSON.stringify(name)+' && document.querySelector("#notice")?.textContent.includes("Workspace renamed")','Save the next received GiveCredit operator edit');
      const after=await receivedClient.state();need(after.name===name&&after.revision>received.revision,'The received workspace edit was not saved.');
      need((await give.client.state()).name===original.name,'The independent receiving edit changed the original GiveCredit workspace.');
      same(await receivedClient.statement(give.statementId,1),giveV1,'The independently received workspace changed the original GiveCredit statement.');
      await image('givecredit-browser-received-mobile.png');
      const next=await download('#handover-link','browser-actions/givecredit/received-after-edit.json');
      need(JSON.parse(next.content).workspace.name===name,'The receiving export omitted the next operator edit.');
      return {...giveReceived,revision:after.revision,name,nextEditSaved:true};
    });

    result.completedAt=new Date().toISOString();result.status='complete';
    await save('browser-actions/complete.json',result);
    return {carbonReceived,giveReceived,...result,carbonStatementId,
      carbonCustomerId:customer.id,carbonProjectId:project.id,carbonAssignmentId:assignment.id,giveStatementId:give.statementId};
  }catch(error){
    result.status='interrupted';result.error={message:error.message,stack:error.stack};result.interruptedAt=new Date().toISOString();
    await save('browser-actions/interrupted.json',result);throw error;
  }
}
