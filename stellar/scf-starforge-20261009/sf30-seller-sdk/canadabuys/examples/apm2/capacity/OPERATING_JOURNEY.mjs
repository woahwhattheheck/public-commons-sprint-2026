// MIT. Complete operator journey against the planner's original static route.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function operateAPM2Capacity({ page, url, directory }) {
 await mkdir(directory,{recursive:true}); const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await page.waitForSelector('#scenario-list button');
 page.on('dialog',dialog=>dialog.accept());
 const input=async(selector,value)=>{await page.locator(selector).fill(String(value));await page.locator(selector).press('Tab');};
 await input('#project-title','Capacity operator handover');
 await input('[data-scenario="name"]','Measured pipeline');
 for(const k of ['metrics','logs']){await page.locator('[data-include="'+k+'"]').uncheck();}
 // Explicit arithmetic exercise values, entered through the visible editor.
 const values={averageRate:100,peakRate:200,spansPerRequest:3,bytesPerItem:1000,averageRetainedFraction:0.5,peakRetainedFraction:1,transportFactor:0.5,storageFactor:2,retentionDays:7,bufferSeconds:60,bufferFactor:1.2};
 for(const[key,value]of Object.entries(values))await input('[data-signal="traces"][data-field="'+key+'"]',value);
 await page.locator('[data-tab="results"]').click();
 const resultText=await page.locator('#view').innerText();
 if(!resultText.includes('Measured pipeline'))throw Error('Scenario name did not persist');
 if(!resultText.includes('12.96')||!resultText.includes('181.44'))throw Error('Entered trace results differ');
 await page.screenshot({path:join(directory,'capacity-results.png'),fullPage:true});
 await page.locator('[data-tab="costs"]').click();
 await input('[data-scenario="horizonMonths"]',12);
 await page.locator('#add-cost').click();await input('[data-cost="0"][data-cost-field="label"]','Entered recurring amount');
 await input('[data-cost="0"][data-cost-field="amount"]','100.10');
 await page.locator('#add-cost').click();await page.locator('[data-cost="1"][data-cost-field="period"]').selectOption('one-time');
 await input('[data-cost="1"][data-cost-field="label"]','Entered setup amount');
 await input('[data-cost="1"][data-cost-field="amount"]','250');
 await page.locator('#duplicate-scenario').click();
 await page.locator('[data-tab="inputs"]').click();await input('[data-scenario="name"]','Higher average');
 await input('[data-signal="traces"][data-field="averageRate"]',150);
 await page.locator('[data-tab="compare"]').click();await page.screenshot({path:join(directory,'scenario-comparison.png'),fullPage:true});
 const jsonEvent=page.waitForEvent('download');await page.locator('#save-project').click();const jsonDownload=await jsonEvent;
 const jsonPath=join(directory,'complete-project.json');await jsonDownload.saveAs(jsonPath);
 const saved=JSON.parse(await readFile(jsonPath,'utf8'));if(saved.scenarios.length!==2)throw Error('Complete scenario export missing');
 const reportEvent=page.waitForEvent('download');await page.locator('#report').click();const reportDownload=await reportEvent;
 const reportPath=join(directory,'complete-report.html');await reportDownload.saveAs(reportPath);
 if(!(await readFile(reportPath,'utf8')).includes('Higher average'))throw Error('Report does not include complete scenario set');
 await page.locator('#new-project').click();await page.locator('#open-project').setInputFiles(jsonPath);
 await page.waitForFunction(()=>document.querySelectorAll('#scenario-list button').length===2);
 const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('tjlabs.apm2.capacity.v1')));
 for(const s of saved.scenarios){const other=restored.scenarios.find(x=>x.id===s.id);if(JSON.stringify(other)!==JSON.stringify(s))throw Error('Receiving changed a saved scenario');}
 await page.locator('[data-tab="compare"]').click();await page.screenshot({path:join(directory,'received-project.png'),fullPage:true});
 if(errors.length)throw Error(errors.join('\n'));
 const result={schema:'tjlabs.apm2.capacity-operator-result.v1',scenarios:2,visibleEntry:true,capacity:true,costs:true,comparison:true,jsonDownload:true,reportDownload:true,independentReopen:true,browserErrors:errors};
 await writeFile(join(directory,'operator-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
}
