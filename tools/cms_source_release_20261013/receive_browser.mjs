#!/usr/bin/env node
/**
 * Operate the maintained CMS source reviewer as a recipient.
 * Uses the host's existing Playwright and Chromium. No browser install or data fetch.
 * Supply the original publisher archive or complete original-source transfer and reviewed request.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync,inflateRawSync} from 'node:zlib';
import {createRequire} from 'node:module';
import * as Core from './release_core.mjs';
import * as Csv from './release_csv.mjs';
import * as Archive from './archive_core.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const utf8=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
const same=(a,b)=>Core.stable(a)===Core.stable(b);
const need=(value,message)=>{if(!value)throw Error(message);};
const args={};
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];
  if(key==='--help'){console.log('node receive_browser.mjs --viewer review-desk.html [--archive /actual/publisher.zip | --prior-source /actual/complete-original-source.json] --request /actual/reviewed-request.json --output /owned/receiving --chromium /existing/chromium [--playwright /existing/playwright/index.mjs] [--page-url https://chatgpt.com/space/page_ID --cdp-url http://127.0.0.1:9222] [--published-fragment /actual/Page-app.html --published-sha SHA256] [--archive-sha SHA256] [--csv-sha SHA256] [--reviewer NAME] [--recipient-brief /actual/outgoing-brief.txt] [--recipient-csv /actual/outgoing.csv]');process.exit(0);}
  need(key.startsWith('--')&&i+1<process.argv.length&&!process.argv[i+1].startsWith('--'),'Use --name value arguments');
  need(!Object.hasOwn(args,key.slice(2)),'Duplicate option '+key);
  args[key.slice(2)]=process.argv[++i];
}
const allowed=new Set(['viewer','archive','prior-source','request','output','chromium','playwright','page-url','cdp-url','published-fragment','published-sha','archive-sha','csv-sha','reviewer','timeout','recipient-brief','recipient-csv']);
for(const key of Object.keys(args))need(allowed.has(key),'Unknown option --'+key);
for(const key of ['viewer','request','output','chromium'])need(args[key],'Required --'+key);
need(!!args.archive!==!!args['prior-source'],'Choose exactly one --archive or --prior-source input');
need(!args['archive-sha']||args.archive,'--archive-sha requires the actual --archive input');
need(!args['cdp-url']||args['page-url'],'An existing browser connection needs the actual published Page URL');
need(!args['page-url']||args['published-fragment'],'Actual Page receiving needs its exact captured --published-fragment and SHA');
need(!args['published-fragment']||args['published-sha'],'A captured Page fragment needs its exact observed SHA-256');
if(args['page-url'])need(/^https:\/\/chatgpt\.com\/(?:space\/)?page_[A-Za-z0-9]+(?:[/?#].*)?$/.test(args['page-url']),'Use the actual observed ChatGPT Page URL');
const timeout=Number(args.timeout||120000);
need(Number.isFinite(timeout)&&timeout>=10000&&timeout<=600000,'Timeout must be 10000..600000ms');
const reviewer=args.reviewer||'Recipient receiving operator';
const output=path.resolve(args.output),downloads=path.join(output,'downloads'),images=path.join(output,'images');
await fs.mkdir(downloads,{recursive:true});await fs.mkdir(images,{recursive:true});
const record={schema:'cms-recipient-course/1',started_at:new Date().toISOString(),status:'RUNNING',source:{},steps:[],downloads:[],screens:[],runtime:{node:process.version},published:{page_url:args['page-url']||null,status:'NOT_REQUESTED'}};
let browser,externalBrowser;
async function save(){
  const tmp=path.join(output,'receiving.json.tmp');await fs.writeFile(tmp,JSON.stringify(record,null,2)+'\n');await fs.rename(tmp,path.join(output,'receiving.json'));
}
async function step(name,fn){
  const event={name,started_at:new Date().toISOString(),status:'RUNNING'};record.steps.push(event);await save();
  try{const result=await fn();event.status='COMPLETE';event.completed_at=new Date().toISOString();if(result!==undefined)event.result=result;await save();return result;}
  catch(error){event.status='FAILED';event.error=error.message;event.completed_at=new Date().toISOString();await save();throw error;}
}
async function fileDescriptor(file){const bytes=await fs.readFile(file);return{path:path.resolve(file),bytes:bytes.length,sha256:hash(bytes)};}
function decodeViewer(html){
  const compressed=html.match(/<script type="application\/json" id="compressed-source">([\s\S]*?)<\/script>/);
  need(compressed,'Use the complete maintained source reviewer');
  const m=JSON.parse(compressed[1]),gz=Buffer.from(m.gzipBase64,'base64');
  need(gz.length===m.gzip_bytes&&hash(gz)===m.gzip_sha256,'Viewer compressed source differs');
  const raw=gunzipSync(gz);need(raw.length===m.source_bytes&&hash(raw)===m.source_sha256,'Viewer original source differs');
  return JSON.parse(utf8(raw));
}
function htmlIdentity(html){
  const payload=decodeViewer(html);
  const styles=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const mainScript=scripts.find(text=>text.includes('async function receiveCompleteViewer()'));
  need(styles.length&&mainScript,'Complete maintained reviewer style and receiving script are required');
  return{payload,styles,mainScript};
}
function bindPublishedFragment(viewer,fragment,expectedSHA){
  need(hash(Buffer.from(fragment,'utf8'))===expectedSHA,'Captured published Page fragment SHA differs');
  const original=htmlIdentity(viewer),published=htmlIdentity(fragment);
  need(same(published.payload,original.payload),'Published fragment embedded original source or comparison template differs');
  need(published.mainScript===original.mainScript,'Published fragment receiving code differs from the outgoing source');
  return published;
}
async function download(page,root,selector,name){
  const event=page.waitForEvent('download',{timeout});
  await root.locator(selector).click();
  const item=await event;
  const target=path.join(downloads,name);
  await item.saveAs(target);const error=await item.failure();need(!error,'Download failed: '+error);
  const desc={...await fileDescriptor(target),suggested_filename:item.suggestedFilename(),control:selector};
  record.downloads.push(desc);await save();return target;
}
async function json(file){return JSON.parse(utf8(await fs.readFile(file)).replace(/^\uFEFF/,''));}
async function visible(root,selector){await root.locator(selector).waitFor({state:'visible',timeout});}
async function ready(root){await visible(root,'#workbench');need((await root.locator('#rows tr').count())>0,'No source rows rendered');}
async function details(root,id){const item=root.locator(id);if(await item.count())await item.evaluate(el=>{el.open=true;});}
async function visual(page,root,name){
  const records=[];
  for(const width of [1440,390])for(const scheme of ['light','dark']){
    await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:scheme});
    await root.locator('h1').first().scrollIntoViewIfNeeded();
    const namePart=name+'-'+width+'-'+scheme;
    const target=path.join(images,namePart+'.png');
    await page.screenshot({path:target,fullPage:true,animations:'disabled'});
    const geometry=await root.locator('body').evaluate(body=>{
      const doc=body.ownerDocument,win=doc.defaultView;
      const controls=[...doc.querySelectorAll('button,input,select,textarea,label,summary')].filter(el=>{
        const r=el.getBoundingClientRect(),s=win.getComputedStyle(el);return r.width&&r.height&&s.visibility!=='hidden';
      }).map(el=>{const r=el.getBoundingClientRect(),s=win.getComputedStyle(el);return{id:el.id,tag:el.tagName,text:(el.innerText||el.getAttribute('aria-label')||'').slice(0,160),disabled:!!el.disabled,color:s.color,background:s.backgroundColor,opacity:s.opacity,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};});
      return{viewport:win.innerWidth,document_width:doc.documentElement.scrollWidth,body_width:body.scrollWidth,controls};
    });
    const entry={name:namePart,...await fileDescriptor(target),width,color_scheme:scheme,geometry};
    record.screens.push(entry);records.push({name:namePart,path:target,viewport:width,document_width:geometry.document_width});
    await save();
  }
  await page.setViewportSize({width:1440,height:900});await page.emulateMedia({colorScheme:'light'});
  return records;
}
async function mapping(root,request,headers){
  await details(root,'#csv-original-intake');await visible(root,'#csv-intake-fields');
  await root.locator('#csv-origin').selectOption(request.origin);
  const m=request.metadata;
  const fields={'csv-resource':request.resource_id,'csv-dataset-url':m.dataset_url,'csv-source-url':m.source_url,
    'csv-dictionary-url':m.dictionary_url||'','csv-captured':m.captured_on,'csv-modified':m.source_modified||'',
    'csv-archive-url':m.archive_url||'','csv-archive-member':m.archive_member||'',
    'csv-archive-date':m.archive_date||'','csv-archive-meaning':m.archive_date_meaning||''};
  for(const [id,value]of Object.entries(fields)){need(typeof value==='string','Actual text value required for '+id);await root.locator('#'+id).fill(value);}
  await root.locator('#csv-publication-status').selectOption(m.source_released===null?'unknown':'known');
  if(m.source_released!==null)await root.locator('#csv-released').fill(m.source_released);
  await details(root,'#csv-date-attribution');
  for(const kind of ['publication','archive']){
    const proof=m.date_provenance?.[kind]||{};
    for(const [suffix,key]of Object.entries({note:'note',url:'source_url',member:'source_member',sha:'source_sha256'})){
      const field='csv-'+kind+'-'+(kind==='archive'?(suffix==='url'?'url-source':suffix==='member'?'member-proof':suffix):suffix);
      await root.locator('#'+field).fill(proof[key]||'');
    }
  }
  const controls=root.locator('#csv-mapping-rows select');
  need(await controls.count()===headers.length,'Browser dropped original CSV columns');
  const wanted=new Map(request.column_mapping.map(row=>[row.source_header,row.field]));
  for(let i=0;i<headers.length;i++){
    const control=controls.nth(i);need(await control.getAttribute('data-header')===headers[i],'Original CSV header order changed');
    await control.selectOption(wanted.get(headers[i])||'');
  }
  await root.locator('#csv-confirm').check();
}
function priorFromTransfer(packet,request){
  const release=Csv.receiveTransfer(packet,hash);
  need(release.manifest.schema===Csv.CSV_RELEASE_VERSION,'The prior transfer must retain one complete original CSV');
  need(request.origin==='official-original','Use the reviewed original publisher CSV request');
  const descriptor=release.manifest.original_csv;
  const source=packet.originals.find(item=>item.path===descriptor.path);
  need(source,'Complete prior transfer is missing its original CSV');
  const original={...descriptor,text:source.text};
  const rebuilt=Csv.buildCsvRelease(original,request,hash);
  need(same(rebuilt.manifest,release.manifest),'Supplied request differs from the original transfer mapping, dates or identity');
  return{release,source:original,packet:{release:packet}};
}
async function receivePriorSource(page,root,file,expected){
  await root.locator('#prior-release-upload').setInputFiles(path.resolve(file));
  await page.waitForFunction(()=>!document.querySelector('#download-comparison-desk').disabled&&document.querySelector('#comparison-status').textContent.includes('independent review'),{},{timeout});
  const bundle=await download(page,root,'#download-comparison-bundle','received-prior-comparison-'+record.steps.length+'.json');
  compareBundle(await json(bundle),expected);
  return bundle;
}
function compareBundle(packet,expected){
  need(packet.schema==='source-comparison-bundle/1','Unknown comparison bundle');
  const before=Csv.receiveTransfer(packet.before,hash),after=Csv.receiveTransfer(packet.after,hash);
  const comparison=Csv.compareEditions(before,after,hash);
  need(same(comparison,packet.comparison),'Comparison differs from complete originals');
  if(expected)need(same(comparison,expected),'Browser comparison differs from independent source reconstruction');
  if(packet.review)Csv.applyChangeReview(comparison,packet.review);
  return{before,after,comparison};
}
async function actualCurrentReview(page,root,current,prefix){
  await ready(root);
  const data=await download(page,root,'#export-data',prefix+'-all-original-fields.csv');
  need(hash(await fs.readFile(data))===current.manifest.data_csv_sha256,'Current original CSV bytes differ');
  const transfer=await download(page,root,'#download-current-transfer',prefix+'-current-complete.json');
  need(same(Csv.receiveTransfer(await json(transfer),hash).records,current.records),'Current source transfer differs');
  await root.locator('#search').fill(current.records[0].facility_id);
  await root.locator('#rows button').first().click();await visible(root,'#record[open]');
  const cells=await root.locator('#record-fields dd').allTextContents();
  need(cells.length===current.manifest.field_count,'Record inspector dropped original fields');
  await root.locator('#record-decision').selectOption('CHECK');await root.locator('#reviewer').fill(reviewer);
  await root.locator('#note').fill('Recipient course: complete original row inspected; source values remain unchanged.');
  await root.locator('#save-review').click();await root.locator('#search').fill('');
  const review=await download(page,root,'#export-review',prefix+'-review.json');
  const checked=Core.applyReview(current,await json(review));need(checked.summary.CHECK>=1,'Recipient review was not retained');
  await download(page,root,'#export-review-csv',prefix+'-review.csv');
  return{data,transfer,review};
}
async function comparisonDownloads(page,root,expected,prefix){
  await visible(root,'#identity');
  const comparisonPath=await download(page,root,'#download-comparison',prefix+'-comparison.json');
  need(same(await json(comparisonPath),expected),'Exported changes differ from actual editions');
  const csvPath=await download(page,root,'#download-changes',prefix+'-all-changes.csv');
  need(utf8(await fs.readFile(csvPath))===Csv.comparisonCSV(expected),'Complete change CSV differs');
  if(expected.changes.length){
    await root.locator('#rows button').first().click();await visible(root,'#record[open]');
    need(await root.locator('#all-fields tr').count()>0,'Original comparison fields are absent');
    await root.locator('#record-decision').selectOption('CHECK');await root.locator('#reviewer').fill(reviewer);
    await root.locator('#note').fill('Recipient course: original before/after values inspected for this retained change.');
    await root.locator('#save-review').click();
  }
  const reviewPath=await download(page,root,'#download-review',prefix+'-review.json');
  Csv.applyChangeReview(expected,await json(reviewPath));
  await download(page,root,'#download-review-csv',prefix+'-review.csv');
  const bundlePath=await download(page,root,'#download-bundle',prefix+'-complete.json');
  compareBundle(await json(bundlePath),expected);
  return{comparisonPath,csvPath,reviewPath,bundlePath};
}
try{
  const viewerBytes=await fs.readFile(args.viewer),viewer=utf8(viewerBytes),payload=decodeViewer(viewer);
  const currentPacket=payload['current-release-transfer'],current=Csv.receiveTransfer(currentPacket,hash);
  const request=await json(args.request),archiveBytes=args.archive?await fs.readFile(args.archive):null;
  const publishedFragment=args['published-fragment']?utf8(await fs.readFile(args['published-fragment'])):null;
  const publishedIdentity=publishedFragment?bindPublishedFragment(viewer,publishedFragment,args['published-sha']):null;
  need(request.origin==='official-original','This recipient course requires the actual original publisher source');
  need(request.metadata?.archive_member,'Use the actual reviewed request with its exact archive member');
  if(args['archive-sha'])need(hash(archiveBytes)===args['archive-sha'],'Original archive SHA differs');
  const services={api:{...Core,...Csv},hash,hashBytes:hash,inflateRaw:async(bytes,expected)=>{
    const out=inflateRawSync(bytes,{maxOutputLength:expected+1});need(out.length===expected,'Deflate source size differs');return out;
  }};
  const originalArchive=args.archive?await Archive.verifyPublisherArchive(archiveBytes,path.basename(args.archive),services):null;
  const expected=originalArchive?await Archive.buildArchiveIntake(originalArchive,request.metadata.archive_member,request,services):priorFromTransfer(await json(args['prior-source']),request);
  const originalCsvPath=path.join(output,path.basename(expected.source.path));
  if(args['csv-sha'])need(expected.source.sha256===args['csv-sha'],'Original CSV SHA differs');
  const headerText=expected.source.text.charCodeAt(0)===0xfeff?expected.source.text.slice(1):expected.source.text;
  const headers=Core.parseCsv(headerText).fields;
  const comparison=Csv.compareEditions(expected.release,current,hash);
  record.source={viewer:await fileDescriptor(args.viewer),input_mode:originalArchive?'publisher-archive':'complete-original-source-transfer',
    ...(originalArchive?{archive:await fileDescriptor(args.archive)}:{prior_source:await fileDescriptor(args['prior-source'])}),request:await fileDescriptor(args.request),
    current_release_id:current.manifest.release_id,current_rows:current.records.length,current_fields:current.manifest.field_count,
    original_member:request.metadata.archive_member,original_csv:{bytes:expected.source.bytes,sha256:expected.source.sha256},
    ...(originalArchive?{archive_members:originalArchive.inventory.length}:{}),prior_release_id:expected.release.manifest.release_id,
    prior_rows:expected.release.records.length,prior_fields:expected.release.manifest.field_count,
    date_metadata:request.metadata,comparison_id:comparison.comparison_id,comparison_summary:comparison.summary,
    ...(args['recipient-brief']?{recipient_brief:await fileDescriptor(args['recipient-brief'])}:{}),
    ...(args['recipient-csv']?{recipient_csv:await fileDescriptor(args['recipient-csv'])}:{}),
    ...(publishedFragment?{published_fragment:await fileDescriptor(args['published-fragment'])}:{})};
  const oldPath=path.join(output,'receiving.json');
  try{const prior=await json(oldPath);if(prior.source?.viewer)need(same(prior.source,record.source),'Output belongs to different original inputs; choose a separate receiving directory');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.writeFile(originalCsvPath,Buffer.from(expected.source.text,'utf8'));
  need(hash(await fs.readFile(originalCsvPath))===expected.source.sha256,'Retained original CSV bytes differ');
  await fs.writeFile(path.join(output,'independent-comparison.json'),JSON.stringify(comparison,null,2)+'\n');
  if(originalArchive)await fs.writeFile(path.join(output,'original-archive-inventory.json'),JSON.stringify(originalArchive.inventory,null,2)+'\n');
  else if(path.resolve(args['prior-source'])!==path.join(output,'original-prior-source.json'))await fs.copyFile(path.resolve(args['prior-source']),path.join(output,'original-prior-source.json'));
  await save();
  let playwright;
  if(args.playwright)playwright=await import(pathToFileURL(path.resolve(args.playwright)).href);
  else{const require=createRequire(import.meta.url);playwright=await import(pathToFileURL(require.resolve('playwright')).href);}
  const chromium=playwright.chromium||playwright.default?.chromium;
  need(chromium,'Use the existing Playwright Chromium package');
  browser=await chromium.launch({executablePath:args.chromium,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  record.runtime.chromium=browser.version();record.runtime.executable=args.chromium;await save();
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:900},colorScheme:'light'});
  const page=await context.newPage();page.setDefaultTimeout(timeout);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve(args.viewer)).href);await ready(page);
  const currentFiles=await step('Current complete source, record review and exports',()=>actualCurrentReview(page,page,current,'current'));
  await step('Current desktop and 390px light/dark screens',()=>visual(page,page,'current'));
  if(!originalArchive)await step('Complete original previous edition through the native receiving control',()=>receivePriorSource(page,page,args['prior-source'],comparison));
  await step(originalArchive?'Original publisher archive, all members and explicit source mapper':'Exact retained original CSV, explicit mapping and source dates',async()=>{
    if(originalArchive){
      await details(page,'#publisher-archive-intake');
      await page.locator('#archive-source-url').fill(request.metadata.archive_url);
      await page.locator('#archive-file').setInputFiles(path.resolve(args.archive));
      await page.waitForFunction(()=>!document.querySelector('#archive-select').disabled,{},{timeout});
      need(await page.locator('#archive-members tr').count()===originalArchive.inventory.length,'Browser original archive member count differs');
      await page.locator('#archive-member').selectOption(request.metadata.archive_member);
      await page.locator('#archive-select').click();
    }else{
      await details(page,'#csv-original-intake');
      await page.locator('#csv-original-file').setInputFiles(originalCsvPath);
    }
    await mapping(page,request,headers);
    need(await page.locator('#csv-released').isDisabled()===(request.metadata.source_released===null),'Publication status control differs from actual source attribution');
    await page.locator('#csv-intake-fields').scrollIntoViewIfNeeded();
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});
      const target=path.join(images,'original-mapping-'+width+'.png');
      await page.screenshot({path:target,fullPage:true,animations:'disabled'});
      record.screens.push({name:'original-mapping-'+width,...await fileDescriptor(target),width});
    }
    await page.setViewportSize({width:1440,height:900});
    await page.locator('#csv-submit').click();
    await page.waitForFunction(()=>!document.querySelector('#csv-download-transfer').disabled&&!document.querySelector('#download-comparison-desk').disabled,{},{timeout});
    const imported=await download(page,page,'#csv-download-transfer','publisher-csv-complete.json');
    const rebuilt=Csv.receiveTransfer(await json(imported),hash);
    need(same(rebuilt.records,expected.release.records),'Browser changed original CSV source cells');
    need(same(rebuilt.manifest,expected.release.manifest),'Browser mapping/date/dictionary metadata differs from the supplied actual request');
    const mappingFile=await download(page,page,'#csv-download-request','publisher-mapping-request.json');
    const savedRequest=await json(mappingFile);
    need(same(Csv.normalizeCsvRequest(savedRequest,headers),Csv.normalizeCsvRequest(request,headers)),'Retained original mapping request differs');
    if(!originalArchive)return{imported,mappingFile,original_csv:await fileDescriptor(originalCsvPath)};
    const originalZip=await download(page,page,'#archive-original-download','untouched-publisher-original.zip');
    need(hash(await fs.readFile(originalZip))===hash(archiveBytes),'Downloaded original ZIP bytes differ');
    const intakePath=await download(page,page,'#archive-intake-download','publisher-archive-intake.json');
    const received=await Archive.receiveArchiveIntake(await json(intakePath),services);
    need(same(received.release.manifest,expected.release.manifest),'Independent archive receiving differs');
    return{imported,mappingFile,intakePath,originalZip};
  });
  const comparisonHtml=await step('Complete comparison and all retained original sources',async()=>{
    const html=await download(page,page,'#download-comparison-desk','cms-comparison-review.html');
    const bundle=await download(page,page,'#download-comparison-bundle','cms-comparison-complete.json');
    compareBundle(await json(bundle),comparison);return html;
  });
  await context.close();
  const second=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:900},colorScheme:'light'});
  const reopened=await second.newPage();reopened.setDefaultTimeout(timeout);reopened.on('pageerror',error=>errors.push(error.message));
  await step('Recipient cold reopen, complete change review and downloads',async()=>{
    await reopened.goto(pathToFileURL(comparisonHtml).href);await visible(reopened,'#identity');
    const receipt=await comparisonDownloads(reopened,reopened,comparison,'recipient-comparison');
    await reopened.locator('details').evaluateAll(items=>{for(const item of items)item.open=true;});
    const sourceButtons=reopened.locator('#source-before button,#source-after button');
    const originals=[{side:'before',...expected.packet.release},{side:'after',...currentPacket}].flatMap(p=>p.originals.map(o=>({side:p.side,...o})));
    need(await sourceButtons.count()===originals.length,'Recipient original-source download controls differ');
    for(let i=0;i<originals.length;i++){
      const event=reopened.waitForEvent('download',{timeout});await sourceButtons.nth(i).click();const d=await event;
      const target=path.join(downloads,'recipient-original-'+i+'-'+path.basename(originals[i].path));await d.saveAs(target);
      need(hash(await fs.readFile(target))===hash(originals[i].text),'Recipient original source download differs');
      record.downloads.push({...await fileDescriptor(target),original_source:originals[i].path,side:originals[i].side});
    }
    await visual(reopened,reopened,'recipient-comparison');
    await reopened.reload();await visible(reopened,'#identity');
    await reopened.locator('#import-review').setInputFiles(receipt.reviewPath);
    await reopened.waitForFunction(()=>document.querySelector('#status').textContent==='Complete source-bound review received.',{},{timeout});
    const reexport=await download(reopened,reopened,'#download-review','recipient-reopened-review.json');
    need(same(await json(reexport),await json(receipt.reviewPath)),'Reopened recipient review differs');
    return receipt;
  });
  await step(originalArchive?'Fresh browser archive intake replay and original current review import':'Fresh browser complete prior-source replay and original current review import',async()=>{
    await reopened.goto(pathToFileURL(path.resolve(args.viewer)).href);await ready(reopened);
    await reopened.locator('#import-review').setInputFiles(currentFiles.review);
    await reopened.waitForFunction(()=>document.querySelector('#status').textContent.includes('Imported'),{},{timeout});
    const review=await download(reopened,reopened,'#export-review','current-reopened-review.json');
    need(same(await json(review),await json(currentFiles.review)),'Current review did not reopen');
    if(!originalArchive){
      const replay=await receivePriorSource(reopened,reopened,path.join(output,'original-prior-source.json'),comparison);
      return{replay};
    }
    await details(reopened,'#publisher-archive-intake');
    await reopened.locator('#archive-receive-file').setInputFiles(path.join(downloads,'publisher-archive-intake.json'));
    await reopened.waitForFunction(()=>document.querySelector('#archive-status').textContent.startsWith('Original archive and all'),{},{timeout});
    const replay=await download(reopened,reopened,'#download-comparison-bundle','archive-replayed-comparison.json');
    compareBundle(await json(replay),comparison);return{replay};
  });
  await second.close();
  if(args['recipient-brief']||args['recipient-csv']){
    await step('Original attachment retention, normal brief opening and supplementary literal views',async()=>{
      const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
      const pieces=[],sourceFiles=[];
      let originalBrief=null,originalCSV=null;
      if(args['recipient-brief']){
        const bytes=await fs.readFile(args['recipient-brief']),text=utf8(bytes);
        const target=path.join(downloads,'recipient-brief-original.txt');await fs.writeFile(target,bytes);
        sourceFiles.push(await fileDescriptor(target));originalBrief={path:target,text};
        pieces.push('<section><h2>Complete original workshare brief</h2><p>'+bytes.length+' original UTF-8 bytes · SHA256 '+hash(bytes)+'</p><pre>'+escape(text)+'</pre><a href="'+pathToFileURL(target).href+'">Open the unchanged original text</a></section>');
      }
      if(args['recipient-csv']){
        const bytes=await fs.readFile(args['recipient-csv']),text=utf8(bytes);
        need(hash(bytes)===current.manifest.data_csv_sha256,'Actual outgoing CSV differs from the complete current edition');
        const parsed=Core.parseCsv(text.charCodeAt(0)===0xfeff?text.slice(1):text);
        need(same(parsed.fields,current.manifest.fields)&&same(parsed.rows,current.records.map(row=>row.original)),'Actual CSV rows/fields differ from original current source');
        const target=path.join(downloads,'recipient-csv-original.csv');await fs.writeFile(target,bytes);
        sourceFiles.push(await fileDescriptor(target));originalCSV=await fileDescriptor(target);
        pieces.push('<section><h2>Complete original CSV attachment</h2><p>'+parsed.rows.length+' records · '+parsed.fields.length+' original fields · '+bytes.length+' bytes · SHA256 '+hash(bytes)+'</p><div class="table"><table><thead><tr>'+parsed.fields.map(value=>'<th>'+escape(value)+'</th>').join('')+'</tr></thead><tbody>'+parsed.rows.map(row=>'<tr>'+parsed.fields.map(field=>'<td>'+escape(row[field])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><a href="'+pathToFileURL(target).href+'">Open the unchanged original CSV</a></section>');
      }
      const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Supplementary literal attachment view</title><style>:root{color-scheme:light}body{margin:0;background:#f7f7f7;color:#202020;font:14px/1.5 Arial,sans-serif}main{padding:20px;max-width:1320px;margin:auto;color:#202020;background:#f7f7f7}section{padding:16px;margin:16px 0;background:white;color:#202020;border:1px solid #aaa}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}p,a{overflow-wrap:anywhere;color:#202020}.table{max-height:650px;overflow:auto}table{border-collapse:collapse;font-size:12px}th,td{padding:8px;text-align:left;vertical-align:top;border:1px solid #bbb;color:#202020;background:white;white-space:pre-wrap;min-width:120px}th{background:#eee}@media(max-width:650px){main{padding:10px}section{padding:10px}}</style></head><body><main><h1>Supplementary literal attachment view</h1><p>Literal text and cells from the unchanged outgoing files. This authored view supplements opening those original files in the recipient’s normal text and spreadsheet/data applications.</p>'+pieces.join('')+'</main></body></html>';
      const file=path.join(output,'recipient-attachments.html');await fs.writeFile(file,html);
      const context=await browser.newContext({viewport:{width:1440,height:900}}),attachmentPage=await context.newPage();
      try{
        if(originalBrief){
          await attachmentPage.goto(pathToFileURL(originalBrief.path).href);
          const literal=await attachmentPage.locator('body').innerText();
          const normalized=text=>text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
          need(normalized(literal)===normalized(originalBrief.text),'Normal text viewer differs from original brief');
          for(const width of [1440,390])for(const scheme of ['light','dark']){
            await attachmentPage.setViewportSize({width,height:900});await attachmentPage.emulateMedia({colorScheme:scheme});
            const target=path.join(images,'original-brief-normal-viewer-'+width+'-'+scheme+'.png');
            await attachmentPage.screenshot({path:target,fullPage:true,animations:'disabled'});
            record.screens.push({name:'original-brief-normal-viewer-'+width+'-'+scheme,...await fileDescriptor(target),width,color_scheme:scheme,context:'unchanged original text file opened directly in Chromium’s normal plaintext viewer',source:await fileDescriptor(originalBrief.path)});
          }
        }
        await attachmentPage.goto(pathToFileURL(file).href);
        for(const width of [1440,390])for(const scheme of ['light','dark']){
          await attachmentPage.setViewportSize({width,height:900});await attachmentPage.emulateMedia({colorScheme:scheme});
          const target=path.join(images,'actual-attachments-'+width+'-'+scheme+'.png');await attachmentPage.screenshot({path:target,fullPage:true,animations:'disabled'});
          record.screens.push({name:'actual-attachments-'+width+'-'+scheme,...await fileDescriptor(target),width,color_scheme:scheme,context:'supplementary authored literal view of the unchanged original brief and complete CSV; not the recipient’s normal spreadsheet/data viewer'});
        }
      }finally{await context.close();}
      record.downloads.push(...sourceFiles);return{supplementary_view:await fileDescriptor(file),originals:sourceFiles,normal_brief_opened:!!originalBrief,normal_csv_viewer:originalCSV?{status:'RECEIVING_HOST_TO_OPEN_ORIGINAL',original:originalCSV,instruction:'Open this exact unchanged CSV in the existing spreadsheet/data viewer, retain its import/document identity, inspect all original columns and representative literal identifiers, and return actual screenshots for the producing reviewer to look at.'}:null};
    });
  }
  if(args['published-fragment']){
    await step('Exact captured published Page fragment in light and dark host frames',async()=>{
      const fragment=Buffer.from(publishedFragment,'utf8');
      const fragmentContext=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:900}});
      const host=await fragmentContext.newPage();host.setDefaultTimeout(timeout);
      for(const scheme of ['light','dark']){
        await host.setContent('<!doctype html><html><body style="margin:0;padding:12px;background:'+(scheme==='dark'?'#161616':'#eee')+';color:'+(scheme==='dark'?'#eee':'#161616')+'"><iframe id="published" style="width:100%;height:900px;border:0"></iframe></body></html>');
        await host.locator('#published').evaluate((frame,text)=>{frame.srcdoc=text;},utf8(fragment));
        const target=host.frameLocator('#published');await ready(target);
        await target.locator('#search').fill(current.records[0].facility_id);await target.locator('#rows button').first().click();
        await visible(target,'#record[open]');await target.locator('#close-record').click();await target.locator('#search').fill('');
        for(const width of [1440,390]){
          await host.setViewportSize({width,height:960});await host.emulateMedia({colorScheme:scheme});
          const file=path.join(images,'published-fragment-'+width+'-'+scheme+'.png');await host.screenshot({path:file,fullPage:true,animations:'disabled'});
          record.screens.push({name:'published-fragment-'+width+'-'+scheme,...await fileDescriptor(file),width,color_scheme:scheme,context:'exact captured Page fragment in an authored receiving host'});
        }
      }
      await fragmentContext.close();return{sha256:hash(fragment),live_page:false};
    });
  }
  if(args['page-url']){
    await step('Actual published Page recipient controls and images',async()=>{
      need(args['cdp-url'],'Actual private Page receiving needs --cdp-url for an already authenticated browser; standalone and captured-fragment results remain separately retained');
      externalBrowser=await chromium.connectOverCDP(args['cdp-url']);
      const existing=externalBrowser.contexts()[0];need(existing,'No existing authenticated browser context');
      const actual=await existing.newPage();actual.setDefaultTimeout(timeout);
      try{
        await actual.goto(args['page-url'],{waitUntil:'domcontentloaded'});
        let frame;
        const end=Date.now()+timeout;
        while(Date.now()<end){
          for(const candidate of actual.frames()){
            try{if(await candidate.locator('#workbench').count()&&await candidate.locator('#workbench').isVisible()){frame=candidate;break;}}catch{/* The host may replace an iframe while opening the Page. */}
          }
          if(frame)break;await new Promise(resolve=>setTimeout(resolve,250));
        }
        need(frame,'The actual published Page did not expose the maintained source-review controls in this authenticated session');
        await ready(frame);
        const actualStyles=await frame.locator('style').allTextContents(),actualScripts=await frame.locator('script').allTextContents();
        need(publishedIdentity.styles.every(style=>actualStyles.includes(style)),'Actual Page styles differ from its exact captured scoped fragment');
        need(actualScripts.includes(publishedIdentity.mainScript),'Actual Page script differs from its exact captured receiving code');
        const raw=await frame.locator('#current-release-transfer').textContent();
        need(same(JSON.parse(raw),currentPacket),'Actual published Page uses a different original source edition');
        await frame.locator('#search').fill(current.records[0].facility_id);
        await frame.locator('#rows button').first().click();await visible(frame,'#record[open]');
        await frame.locator('#close-record').click();await frame.locator('#search').fill('');
        const full=await download(actual,frame,'#download-current-transfer','actual-page-complete-current.json');
        need(same(Csv.receiveTransfer(await json(full),hash).records,current.records),'Actual Page source download differs');
        await visual(actual,frame,'actual-published-page');
        record.published={page_url:args['page-url'],status:'OPERATED',frame_url:frame.url(),download:full,fragment_sha256:args['published-sha'],style_sha256:publishedIdentity.styles.map(hash),main_script_sha256:hash(publishedIdentity.mainScript)};
      }finally{await actual.close();}
      return record.published;
    });
  }
  need(errors.length===0,'Browser runtime errors: '+errors.join('; '));
  record.status='COMPLETE';record.completed_at=new Date().toISOString();
  record.visual_review='Actual images are retained for the producing reviewer to open and inspect. Human/model pixel inspection is a separate recorded action.';
  await save();console.log(JSON.stringify({status:record.status,result:path.join(output,'receiving.json'),downloads:record.downloads.length,screens:record.screens.length,comparison:record.source.comparison_summary,published:record.published},null,2));
}catch(error){
  record.status='FAILED';record.error=error.stack||error.message;record.completed_at=new Date().toISOString();await save();
  console.error(JSON.stringify({status:record.status,result:path.join(output,'receiving.json'),error:error.message},null,2));process.exitCode=1;
}finally{
  if(browser)await browser.close();
  // Do not close the externally owned CDP browser/profile. End only this driver connection.
  if(externalBrowser)process.exit(process.exitCode||0);
}
