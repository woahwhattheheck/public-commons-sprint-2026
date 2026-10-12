import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const [connectionFile,output,profile]=process.argv.slice(2);
const require=createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'study-native.cjs'));
const {chromium}=require('playwright');
const connection=JSON.parse(await readFile(connectionFile,'utf8'));
const native=JSON.parse(await readFile(join(output,'native-result.json'),'utf8'));
await mkdir(profile,{recursive:true,mode:0o700});
const errors=[];
const browser=await chromium.launchPersistentContext(profile,{
 executablePath:'/workspace/scratch/5403360e55a4/fleet-lightweight/shared/swarm/toolchains/browser/chromium-153.0.0/chromium',
 headless:true,viewport:{width:1440,height:1000},
 args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--renderer-process-limit=2'],
});
try {
 const page=await browser.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 const denied=await page.request.post(connection.base_url+'/api',{data:{operation:'status',arguments:{}}});
 if(denied.status()!==401&&denied.status()!==403)throw Error('Unauthenticated API returned '+denied.status());
 const badOrigin=await page.request.post(connection.base_url+'/api',{
  headers:{Authorization:'Bearer '+connection.token,Origin:'https://example.invalid'},
  data:{operation:'status',arguments:{}}});
 if(badOrigin.status()!==403)throw Error('Cross-origin operator request returned '+badOrigin.status());
 await page.goto(connection.base_url+'/#'+connection.token,{waitUntil:'domcontentloaded'});
 await page.locator('#metrics .metric').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('#notice').dataset.busy==='false');
 if(new URL(page.url()).hash)throw Error('Operator fragment was not removed');
 const metricText=await page.locator('#metrics').innerText();
 if(!metricText.includes('Sources')||!metricText.includes('4'))throw Error('Retained sources absent');
 await page.getByRole('button',{name:'Sources',exact:true}).click();
 await page.locator('#source-list tbody tr').nth(3).waitFor();
 if(await page.locator('#source-list tbody tr').count()!==4)throw Error('Original source edition count differs');
 await page.locator('#source-list tbody tr').first().getByRole('button',{name:'Open inventory'}).click();
 await page.getByRole('button',{name:'Read observation records',exact:true}).click();
 await page.locator('#sample-table tbody tr').first().waitFor();
 await page.locator('#sample-table tbody tr').first().getByRole('button',{name:'Open',exact:true}).click();
 const sourceRecord=JSON.parse(await page.locator('#detail-body').innerText());
 if(!sourceRecord.source_locator.file||!sourceRecord.source_hash||!sourceRecord.reference_period)throw Error('Original row custody absent');
 await page.getByRole('button',{name:'Close record'}).click();
 await page.getByRole('button',{name:'Portfolio',exact:true}).click();
 await page.locator('#portfolio-load').selectOption(native.portfolio_id);
 await page.locator('#load-portfolio').click();
 await page.waitForFunction(()=>document.querySelector('#notice').dataset.busy==='false');
 const selectedGeoRows=await page.locator('#portfolio-table tbody tr').count();
 if(selectedGeoRows<10)throw Error('Frozen portfolio was not reopened');
 await page.getByRole('button',{name:'Export mapping',exact:true}).click();
 await page.locator('#load-mapping').click();
 await page.waitForFunction(()=>document.querySelector('#notice').dataset.busy==='false');
 if(await page.locator('#column-table tbody tr').count()<10)throw Error('Frozen mapping columns absent');
 await page.getByRole('button',{name:'Comparison & review',exact:true}).click();
 await page.locator('#review-comparison').selectOption(native.comparison_id);
 await page.locator('#review-comparison').dispatchEvent('change');
 await page.locator('#review-table tbody tr').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('#notice').dataset.busy==='false');
 if(!(await page.locator('#review-summary').innerText()).includes('Pending reviews: 0'))throw Error('Saved review did not reopen');
 await page.locator('#review-table tbody tr').first().getByRole('button',{name:'Open',exact:true}).click();
 await page.getByRole('button',{name:'Read original row',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#detail-title').textContent==='Native provider row and retained interpretation');
 const original=JSON.parse(await page.locator('#detail-body').innerText());
 if(!original.native||!original.canonical.source_hash)throw Error('Native provider row unavailable in operator');
 await page.getByRole('button',{name:'Close record'}).click();
 await page.screenshot({path:join(output,'comparison-desktop.png'),fullPage:true});
 await page.locator('#review-table tbody tr').first().locator('input[type=checkbox]').check();
 await page.locator('#review-operator').fill('Receiving study operator');
 await page.locator('#review-note').fill('Reviewed the received native source record and preserved the original source units, annotations and period labels.');
 await page.locator('#review-accept').click();
 await page.waitForFunction(()=>document.querySelector('#notice').dataset.busy==='false');
 if(await page.locator('#notice').getAttribute('data-error')==='true')throw Error(await page.locator('#notice').innerText());
 await page.getByRole('button',{name:'Delivery & reopen',exact:true}).click();
 await page.locator('#export-list tbody tr').first().waitFor();
 const retained=page.locator('#export-list tbody tr').filter({hasText:'Received'}).first();
 if(await retained.count()!==1)throw Error('Full incoming package is absent');
 await retained.getByRole('button',{name:'Verify',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#detail-title').textContent==='Verified package');
 const packet=JSON.parse(await page.locator('#detail-body').innerText());
 if(packet.package_id!==native.package_id||packet.files.length<100)throw Error('Retained packet changed');
 await page.getByRole('button',{name:'Close record'}).click();
 const downloaded=page.waitForEvent('download');
 await retained.getByRole('button',{name:'Download ZIP',exact:true}).click();
 const download=await downloaded;
 if(await download.failure())throw Error('Native package download failed');
 const stream=await download.createReadStream(),hash=createHash('sha256');let bytes=0;
 for await(const chunk of stream){hash.update(chunk);bytes+=chunk.length;}
 if(bytes<100000)throw Error('Native package download was truncated');
 const downloadedSha=hash.digest('hex');
 await page.screenshot({path:join(output,'delivery-desktop.png'),fullPage:true});
 await page.setViewportSize({width:960,height:900});
 await page.getByRole('button',{name:'Workspace',exact:true}).click();
 await page.screenshot({path:join(output,'workspace-compact.png'),fullPage:true});
 if(errors.length)throw Error('Browser page errors: '+errors.join('; '));
 const result={source_inventory:true,native_record:true,frozen_mapping:true,received_review:true,
  operator_review_saved:true,received_package_verified:true,download_bytes:bytes,download_sha256:downloadedSha,
  unauthenticated_status:denied.status(),cross_origin_status:badOrigin.status(),console_errors:0,
  screenshots:['comparison-desktop.png','delivery-desktop.png','workspace-compact.png']};
 await writeFile(join(output,'browser-result.json'),JSON.stringify(result,null,2),{mode:0o600});
 console.log(JSON.stringify(result));
} finally {await browser.close();}
