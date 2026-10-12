// MIT. Original IATI and installed Applications browser receiving.
// The owning operator callback supplies the live original URLs and saved selections.
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const check=(value,message)=>{if(!value)throw Object.assign(new Error(message),{code:'IATI_RECEIVING_BROWSER'});};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
async function idle(page){
 await page.waitForFunction(()=>document.querySelector('#main')?.getAttribute('aria-busy')==='false',{},{timeout:240000});
 const status=await page.locator('#status').textContent();
 check(!await page.locator('#status').evaluate(el=>el.classList.contains('error')),status);
 return status;
}
async function choose(page,view){
 await page.locator('nav [data-view="'+view+'"]').click();
 await page.locator('[data-panel="'+view+'"]').waitFor({state:'visible'});
}
async function openPortfolio(page,id,revision){
 await choose(page,'portfolios');
 await page.locator('#portfolio-select').selectOption(id);
 await page.locator('#portfolio-revision').fill(String(revision));
 await page.locator('#portfolio-open').click();await idle(page);
 check((await page.locator('#portfolio-identity').textContent()).includes(id),'The visible portfolio identity changed.');
 check(await page.locator('#portfolio-revision').inputValue()===String(revision),'The visible original revision changed.');
}
function events(page,receipt){
 page.on('pageerror',error=>receipt.pageErrors.push(String(error)));
 page.on('console',message=>{if(message.type()==='error')receipt.consoleErrors.push(message.text());});
 page.on('response',response=>{
  const url=new URL(response.url());
  if(url.origin===new URL(page.url()||'http://127.0.0.1').origin&&
   ['/app.js','/style.css'].includes(url.pathname)&&response.status()!==200)
   receipt.assetErrors.push({path:url.pathname,status:response.status()});
 });
}
async function visibleReport(page,report){
 const actual=await page.locator('#portfolio-report .report-section').evaluateAll(sections=>sections.flatMap(section=>{
  const heading=section.querySelector(':scope > h3')?.textContent;
  if(heading!=='Transactions'&&heading!=='Budgets')return[];
  const table=section.querySelector('table');
  if(!table)return[];
  return[{collection:heading.toLowerCase(),headers:[...table.querySelectorAll('thead th')].map(x=>x.textContent),
   rows:[...table.querySelectorAll('tbody tr')].filter(row=>!row.querySelector('[colspan]'))
    .map(row=>[...row.querySelectorAll('td')].map(cell=>cell.textContent))}];
 }));
 const columns={
  transactions:['reportingOrgRef','hierarchy','currency','transactionType','transactionTypeLabel','valueDate','count','amount'],
  budgets:['reportingOrgRef','hierarchy','currency','budgetType','budgetTypeLabel','budgetStatus','budgetStatusLabel','periodStart','periodEnd','valueDate','count','amount']
 };
 const display=value=>value===null?'Not supplied':value===undefined?'—':typeof value==='object'?JSON.stringify(value):String(value);
 for(const collection of ['transactions','budgets']){
  const table=actual.find(item=>item.collection===collection);
  check(table,'The complete report must expose '+collection+' separately.');
  check(table.headers.includes('Reporting Org Ref')&&table.headers.includes('Hierarchy'),'The report lost its reporting organisation or hierarchy.');
  const expected=report.financialGroups.filter(group=>group.collection===collection).slice(0,75)
   .map(row=>columns[collection].map(key=>display(row[key])));
  check(same(table.rows,expected),'The browser changed reported '+collection+' dimensions or exact decimal strings.');
 }
 return actual;
}
async function screenshot(page,path){
 await page.screenshot({path,fullPage:true});
 const value=await page.evaluate(()=>({
  width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,
  bodyWidth:document.body.scrollWidth,visiblePanel:document.querySelector('[data-panel]:not([hidden])')?.dataset.panel??null,
  title:document.title,heading:document.querySelector('[data-panel]:not([hidden]) h1')?.textContent??null
 }));
 check(value.documentWidth<=value.width+1&&value.bodyWidth<=value.width+1,'The original IATI view overflows its selected viewport.');
 return{path,...value};
}

/** Open the original Applications library and its real verified Open link. */
export async function openInstalledIatiPage({browser,applicationsUrl,applicationLabel,consoleUrl,outputDirectory,name}){
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:1360,height:940}});
 const page=await context.newPage(),receipt={pageErrors:[],consoleErrors:[],assetErrors:[],views:[]};
 page.on('pageerror',error=>receipt.pageErrors.push(String(error)));
 page.on('console',message=>{if(message.type()==='error')receipt.consoleErrors.push(message.text());});
 await page.goto(applicationsUrl,{waitUntil:'domcontentloaded'});
 await page.locator('[data-view="applications"]').click();
 await page.getByRole('heading',{name:'Applications',exact:true}).waitFor();
 const library=page.locator('#application-library');
 const candidate=library.getByRole('button').filter({hasText:applicationLabel});
 if(await candidate.count())await candidate.first().click();
 else{
  // The original library may wrap the title in a labelled link or row action.
  const exact=library.getByText(applicationLabel,{exact:true});
  await exact.first().click();
 }
 await page.getByRole('heading',{name:applicationLabel,exact:true}).waitFor();
 const open=page.getByRole('link',{name:'Open application',exact:true});
 await open.waitFor({state:'visible',timeout:240000});
 check(await open.getAttribute('href')===consoleUrl,'Applications Open must use the original verified startup URL.');
 await page.screenshot({path:join(outputDirectory,name+'-applications.png'),fullPage:true});
 receipt.views.push({path:join(outputDirectory,name+'-applications.png'),width:1360,height:940,applicationLabel});
 const popupPromise=context.waitForEvent('page');await open.click();const consolePage=await popupPromise;
 events(consolePage,receipt);await consolePage.waitForLoadState('domcontentloaded');await idle(consolePage);
 check(new URL(consolePage.url()).origin===new URL(consoleUrl).origin,'Applications opened a different original console.');
 return{context,applicationsPage:page,page:consolePage,receipt};
}

/** Save one actual named review, reopen it, query the native edition and inspect full comparisons. */
export async function receiveIatiBrowser({
 page,receipt,client,portfolio,report,queryBuild,actor,comparisonDefinition,
 outputDirectory,name,retainedReview,persistReview,recordDownload
}){
 page.setDefaultTimeout(240000);
 await openPortfolio(page,portfolio.id,portfolio.revision);
 await visibleReport(page,report);
 let reviewInput=retainedReview;
 if(!reviewInput){
  await page.locator('#review-status').selectOption('reviewed');
  await page.locator('#reviewer').fill(actor.label);
  await page.locator('#review-note').fill('Named operator receiving: original publisher XML, native editions and complete report selected.');
  const route=async route=>{
   if(route.request().method()!=='POST')return route.continue();
   const value=route.request().postDataJSON();
   check(value.id===portfolio.id&&value.expectedRevision===portfolio.revision,'The browser submitted a different original review selection.');
   check(value.review.status==='reviewed'&&value.review.reviewer===actor.label,'The browser lost the actual named reviewer.');
   reviewInput=value;await persistReview(value);await route.continue();
  };
  await page.route('**/api/iati/portfolio',route);
  try{await page.locator('#portfolio-form button[type="submit"]').click();await idle(page);}
  finally{await page.unroute('**/api/iati/portfolio',route);}
  check(reviewInput,'The original browser did not retain its exact review request.');
 }else{
  check(reviewInput.id===portfolio.id&&reviewInput.expectedRevision===portfolio.revision,'The retained UI request names another original revision.');
 }
 // The original request replay is authoritative after any lost browser response.
 const reviewed=await client.savePortfolio(reviewInput),replayed=await client.savePortfolio(reviewInput);
 check(same(reviewed,replayed),'The same retained review request must return its original revision.');
 check(reviewed.revision===portfolio.revision+1&&reviewed.review.reviewer===actor.label&&reviewed.review.status==='reviewed',
  'The named review did not create exactly one expected original revision.');
 const reviewedReport=await client.report(reviewed.id,{revision:reviewed.revision});
 check(same(reviewedReport.counts,report.counts)&&same(reviewedReport.financialGroups,report.financialGroups),
  'A review-only revision changed source financial values or coverage.');
 await page.reload({waitUntil:'domcontentloaded'});await idle(page);
 await openPortfolio(page,reviewed.id,reviewed.revision);
 check(await page.locator('#reviewer').inputValue()===actor.label,'The named reviewer did not survive browser reopen.');
 await visibleReport(page,reviewedReport);
 await page.locator('#portfolio-history').click();await idle(page);
 check((await page.locator('#portfolio-history-result').textContent()).includes('Revision '+portfolio.revision)&&
  (await page.locator('#portfolio-history-result').textContent()).includes('Revision '+reviewed.revision),
  'The complete revision history must retain the original and reviewed revisions.');

 await choose(page,'sources');await page.locator('#source-select').selectOption(portfolio.sources[0]);
 await page.locator('#source-open').click();await idle(page);
 check((await page.locator('#source-identity').textContent()).includes(portfolio.sources[0]),'The displayed publisher source is not the selected original.');

 await choose(page,'query');await page.locator('#build-select').selectOption(queryBuild.id);
 await page.locator('#query-text').fill('limit=2');
 const responsePromise=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/query');
 await page.locator('#query-form button[type="submit"]').click();const queryResponse=await responsePromise;await idle(page);
 const queried=await queryResponse.json(),body=queried.response?.body;
 check(queried.response?.status===200&&Array.isArray(body?.rows)&&body.page.returned===Math.min(2,queryBuild.rowCount),
  'The native query response must contain the real selected rows and original page envelope.');
 const direct=await client.query(queryBuild.id,{limit:'2'});
 check(same(direct.response.body,body),'The visible query differs from the original authenticated native client.');
 const shown=await page.locator('#query-result tbody tr').evaluateAll(rows=>rows.filter(row=>!row.querySelector('[colspan]'))
  .map(row=>[...row.querySelectorAll('td')].map(cell=>cell.textContent)));
 const display=value=>value===null?'Not supplied':value===undefined?'—':typeof value==='object'?JSON.stringify(value):String(value);
 check(same(shown,body.rows.map(row=>body.fields.map(field=>display(row[field])))),'The table changed the exact native row strings.');

 await choose(page,'compare');await page.locator('#compare-portfolio').selectOption(reviewed.id);
 await page.locator('#compare-before-revision').fill(String(comparisonDefinition.beforeRevision));
 await page.locator('#compare-after-revision').fill(String(comparisonDefinition.afterRevision));
 if(comparisonDefinition.pairs){
  await page.locator('#portfolio-compare-form details summary').click();
  await page.locator('#compare-pairs').fill(JSON.stringify(comparisonDefinition.pairs));
 }
 const comparisonResponse=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/iati/compare');
 await page.locator('#portfolio-compare-form button[type="submit"]').click();const answer=await comparisonResponse;await idle(page);
 const comparison=await answer.json();
 check(comparison.portfolio===reviewed.id&&comparison.beforeRevision===comparisonDefinition.beforeRevision&&
  comparison.afterRevision===comparisonDefinition.afterRevision,'The visible comparison lost its exact original revision selection.');
 if(comparisonDefinition.id)check(comparison.id===comparisonDefinition.id,'The original retained comparison identity changed.');
 const native=await client.comparePortfolio(Object.fromEntries(Object.entries(comparisonDefinition).filter(([key])=>key!=='comparisonId'&&key!=='id').concat([['id',reviewed.id]])));
 check(same(native,comparison),'The original repeated comparison changed its saved result.');
 const nativeComparison=comparison.comparisons.find(item=>item.comparison?.id);
 let changes=null;
 if(nativeComparison){
  await page.locator('#comparison-select').selectOption(nativeComparison.comparison.id);
  await page.locator('#comparison-open').click();await idle(page);
  changes=await client.changes(nativeComparison.comparison.id,{limit:50});
  check(Array.isArray(changes.rows),'The original full changes cursor was not available.');
 }

 await openPortfolio(page,reviewed.id,reviewed.revision);
 for(const [button,kind]of[['report-download','report'],['portfolio-download','portfolio']]){
  const waiting=page.waitForEvent('download');await page.locator('#'+button).click();const download=await waiting;await idle(page);
  const saved=await recordDownload(kind,download);receipt[kind+'Download']=saved;
 }
 const views=['overview','sources','portfolios','query','compare','transfer'];
 for(const viewport of[{width:1360,height:940},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const view of views){
   await choose(page,view);
   receipt.views.push(await screenshot(page,join(outputDirectory,name+'-'+viewport.width+'-'+view+'.png')));
  }
 }
 check(receipt.pageErrors.length===0&&receipt.assetErrors.length===0,'The original browser emitted a script or required-asset failure.');
 return{reviewInput,reviewed,report:reviewedReport,query:{build:queryBuild.id,body},comparison,changes,receipt};
}

/** Read an already-received portfolio through the same actual Applications entry. */
export async function inspectReceivedIatiBrowser({page,receipt,client,portfolio,report,outputDirectory,name,receiveFile}){
 if(receiveFile){
  await choose(page,'transfer');await page.locator('#receive-file').setInputFiles(receiveFile);
  await page.locator('#receive-form button[type="submit"]').click();await idle(page);
 }
 await openPortfolio(page,portfolio.id,portfolio.revision);await visibleReport(page,report);
 await page.locator('#portfolio-history').click();await idle(page);
 check((await page.locator('#portfolio-history-result').textContent()).includes('Revision '+portfolio.revision),
  'The received revision history was not reconstructed.');
 const saved=await client.portfolio(portfolio.id,{revision:portfolio.revision});
 check(saved.definitionSha256===portfolio.definitionSha256,'The reopened recipient changed its original portfolio definition.');
 for(const viewport of[{width:1360,height:940},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const view of ['overview','portfolios','transfer']){
   await choose(page,view);
   receipt.views.push(await screenshot(page,join(outputDirectory,name+'-'+viewport.width+'-'+view+'.png')));
  }
 }
 check(receipt.pageErrors.length===0&&receipt.assetErrors.length===0,'The received original browser emitted a script or required-asset failure.');
 return{portfolio:portfolio.id,revision:portfolio.revision,definitionSha256:portfolio.definitionSha256,receipt};
}
