import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const input=JSON.parse(readFileSync(0,'utf8'));
const imported=await import(pathToFileURL(input.playwright).href);
const {chromium}=imported.default||imported;
const output=input.output;
mkdirSync(output,{recursive:true,mode:0o700});
const capability=new URL(input.url).hash.slice(1);
const clean=value=>String(value).split(capability).join('[private capability]');
const result={schema:'stellar-forge.duckdb-gis.native-browser.v1',operation:input.operation,
  native_result_sha256:input.native_result_sha256,source_files:input.source_files,workspace:input.workspace,
  started_at:new Date().toISOString(),stages:[],downloads:[],page_errors:[]};
function persist(){const name=path.join(output,'browser-result.json');writeFileSync(name+'.partial',JSON.stringify(result,null,2)+'\n',{mode:0o600});renameSync(name+'.partial',name);}
function mark(name,value={}){result.stages.push({name,at:new Date().toISOString(),...value});persist();}
const short=value=>value.length>20?value.slice(0,12)+'…'+value.slice(-6):value;
let browser,context;
try {
  browser=await chromium.launch({executablePath:input.chromium,headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  const page=await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror',error=>{result.page_errors.push(clean(error.stack||error));persist();});
  async function action(route,operation){
    const waiting=page.waitForResponse(response=>new URL(response.url()).pathname===route&&response.request().method()==='POST');
    await operation();
    const response=await waiting;
    const value=await response.json();
    assert.equal(response.status(),200,clean(JSON.stringify(value)));
    return value;
  }
  async function query(){
    return action('/api/spatial/query',()=>page.locator('#gis-query-form button[type="submit"]').click());
  }
  await page.goto(input.url,{waitUntil:'domcontentloaded'});
  await page.locator('.nav[data-screen="spatial"]').click();
  await page.locator('#gis-layers .item').first().waitFor();
  const runtime=await action('/api/spatial/runtime',()=>page.locator('#gis-runtime').click());
  assert.equal(runtime.duckdb,'1.5.6');
  mark('opened_original_gis_workspace',{duckdb:runtime.duckdb});

  await page.locator('#gis-edition').selectOption(input.review.edition_id);
  await page.locator('#gis-source-column').selectOption(input.review.geometry_column);
  await page.locator('#gis-format').selectOption(input.review.source_format);
  await page.locator('#gis-crs').fill(input.review.crs);
  await page.locator('#gis-reference-column').selectOption(input.review.spatial_reference_column);
  await page.locator('#gis-geometry-type').selectOption(input.review.geometry_type);
  await page.locator('#gis-keys').fill(input.review.keys.join(', '));
  await page.locator('#gis-geometry-name').fill(input.review.geometry_name);
  const review=await action('/api/spatial/reviews',()=>page.locator('#gis-review-form button[type="submit"]').click());
  assert.equal(review.review_id,input.review.review_id);
  assert.equal(review.row_count,4);
  assert.equal(review.coordinate_count,input.review.coordinate_count);
  assert.deepEqual(review.source_spatial_reference,input.review.source_spatial_reference);
  const layer=await action('/api/spatial/adopt',()=>page.locator('#gis-adopt').click());
  assert.equal(layer.layer_id,input.layer.layer_id);
  await page.locator('#gis-map svg').waitFor();
  assert.equal(await page.locator('#gis-map svg').getAttribute('aria-label'),'Original GIS features in '+input.review.crs);
  assert.ok(await page.locator('#gis-map svg path,#gis-map svg circle').count()>0);
  assert.match(await page.locator('#gis-map-caption').textContent(),/4 displayed features/);
  for(const [i,id] of ['gis-xmin','gis-ymin','gis-xmax','gis-ymax'].entries()){
    assert.equal(Number(await page.locator('#'+id).inputValue()),input.map.extent[i]);
  }
  mark('reopened_exact_review_and_native_map',{review_id:review.review_id,layer_id:layer.layer_id,
    source_crs:review.crs,coordinates:review.coordinate_count,features:review.row_count});
  await page.screenshot({path:path.join(output,'gis-source-map-desktop.png'),fullPage:true});

  await page.locator('#gis-area-crs').fill('EPSG:5070');
  await page.locator('#gis-area').click();
  const area=await query();
  assert.equal(area.rows.length,4);
  assert.ok(area.rows.every(row=>Number(row.at(-1))>0));
  mark('operated_projected_area',{crs:'EPSG:5070',rows:area.rows.length});

  await page.locator('#gis-select-bounds').click();
  const selected=await query();
  assert.equal(selected.rows.length,4);
  assert.ok(selected.columns.some(column=>column.name==='GEOID'));
  await page.locator('#gis-clip-bounds').click();
  const clipped=await query();
  assert.equal(clipped.rows.length,4);
  assert.ok(clipped.columns.some(column=>column.name===input.layer.geometry_name&&column.type.startsWith('GEOMETRY')));
  mark('operated_source_extent_selection_and_clip',{selection_rows:selected.rows.length,clip_rows:clipped.rows.length});

  await page.locator('#gis-queries .item').filter({has:page.locator('.item-title',{hasText:input.query.name})}).click();
  assert.equal(await page.locator('#gis-query-revision').textContent(),'Saved revision '+input.query.revision);
  assert.equal(await page.locator('#gis-sql').inputValue(),input.query.sql);
  assert.deepEqual(JSON.parse(await page.locator('#gis-parameters').inputValue()),input.query.parameters);
  const saved=await query();
  assert.equal(saved.rows.length,4);
  mark('ran_original_saved_spatial_recipe',{query_id:input.query.query_id,revision:input.query.revision,rows:saved.rows.length});

  await page.locator('.nav[data-screen="exports"]').click();
  await page.locator('#export-list .item').filter({hasText:short(input.export.export_id)}).click();
  await page.waitForFunction(id=>JSON.parse(document.querySelector('#export-record').textContent||'{}').export_id===id,input.export.export_id);
  const exported=JSON.parse(await page.locator('#export-record').textContent());
  assert.equal(exported.rows,4);
  assert.equal(exported.crs,input.review.crs);
  assert.equal(exported.receiving.state,'COMPLETE');
  assert.ok((await page.locator('#gis-export-schema').textContent()).includes(input.review.crs));
  assert.ok((await page.locator('#gis-export-schema').textContent()).includes('GeoPackage'));
  for(const name of ['result.gpkg','result.parquet']){
    const expected=exported.files.find(file=>file.name===name);
    assert.ok(expected);
    const pending=page.waitForEvent('download');
    await page.locator('#export-files .item').filter({has:page.locator('.item-title',{hasText:name})}).click();
    const download=await pending;
    const target=path.join(output,name);
    await download.saveAs(target);
    const bytes=readFileSync(target),sha256=createHash('sha256').update(bytes).digest('hex');
    assert.equal(bytes.length,expected.bytes);
    assert.equal(sha256,expected.sha256);
    result.downloads.push({name,bytes:bytes.length,sha256,export_id:exported.export_id});
    persist();
  }
  mark('received_original_complete_gis_files',{export_id:exported.export_id,crs:exported.crs});
  await page.screenshot({path:path.join(output,'gis-receiving-desktop.png'),fullPage:true});
  await page.locator('#export-reopen-query').click();
  assert.equal(await page.locator('#gis-sql').inputValue(),exported.query.sql);
  assert.equal(await page.locator('#gis-query-revision').textContent(),'Saved revision '+exported.query.revision);
  mark('opened_original_export_recipe',{query_id:exported.query.query_id,revision:exported.query.revision});

  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.nav[data-screen="spatial"]').click();
  await page.locator('#gis-layers .item').filter({hasText:short(input.layer.layer_id)}).click();
  await page.locator('#gis-map svg').waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(output,'gis-source-map-mobile.png'),fullPage:true});
  assert.equal(await page.locator('.nav[data-screen="spatial"]').isVisible(),true);
  mark('reopened_same_gis_layer_after_reload',{layer_id:input.layer.layer_id});
  assert.deepEqual(result.page_errors,[]);
  result.complete=true;
  result.completed_at=new Date().toISOString();
  persist();
} catch(error){
  result.complete=false;
  result.error=clean(error.stack||error);
  persist();
  process.exitCode=1;
} finally {
  if(context)await context.close();
  if(browser)await browser.close();
  result.browser_closed=true;
  persist();
}
process.stdout.write(JSON.stringify({complete:result.complete,result:path.join(output,'browser-result.json'),stages:result.stages.length})+'\n');
