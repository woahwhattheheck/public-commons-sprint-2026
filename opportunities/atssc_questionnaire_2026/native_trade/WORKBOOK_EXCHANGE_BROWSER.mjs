#!/usr/bin/env node
/* Operate the full native exchange through its existing customer browser. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const args=process.argv.slice(2),options={};
for(let n=0;n<args.length;n+=2){if(!args[n]?.startsWith('--')||!args[n+1])throw Error('Use --workspace PATH --output NEW_PATH --browser CHROME --playwright MODULE.');options[args[n].slice(2)]=args[n+1];}
if(!options.workspace||!options.output)throw Error('Select the retained workspace and a new private browser output directory.');
const source=path.dirname(fileURLToPath(import.meta.url)),workspace=path.resolve(options.workspace),output=path.resolve(options.output);
await fs.mkdir(output,{recursive:false,mode:0o700});
const {chromium}=await import(options.playwright?pathToFileURL(path.resolve(options.playwright)).href:'playwright');
const server=spawn(options.python||'python3',[path.join(source,'server.py'),'--workspace',workspace,'--port','0'],{stdio:['ignore','pipe','pipe']});
const result={schema:'atssc.whole-original-workbook-exchange-browser.v1',steps:[],page_errors:[],widths:[]};
let browser,stderr='',context,page;
server.stderr.on('data',chunk=>stderr+=chunk.toString());
const check=(condition,message)=>{if(!condition)throw Error(message);};
const note=async(name,detail={})=>{result.steps.push({name,...detail});await fs.writeFile(path.join(output,'browser-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});};
const post=(page,method,params={})=>page.evaluate(async({method,params})=>{const response=await fetch('/api/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});const body=await response.json();if(!response.ok||body.error)throw Error(JSON.stringify(body));return body.result;},{method,params});
const response=(method,condition=()=>true)=>page.waitForResponse(r=>r.url().endsWith('/api/invoke')&&r.request().postDataJSON()?.method===method&&condition(r.request().postDataJSON()?.params||{}));
try{
 let line='';const launch=await new Promise((resolve,reject)=>{server.stdout.on('data',chunk=>{line+=chunk;if(line.includes('\n')){try{resolve(JSON.parse(line.split('\n')[0]));}catch(error){reject(error);}}});server.once('error',reject);server.once('exit',code=>reject(Error('The original server exited '+code+': '+stderr)));});
 result.workspace_id=launch.workspace_id;
 browser=await chromium.launch({headless:true,...(options.browser?{executablePath:options.browser}:{}),args:['--no-sandbox']});
 context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});page=await context.newPage();page.on('pageerror',error=>result.page_errors.push(error.message));
 await page.goto(launch.url);await page.locator('[data-language-select]').selectOption('EN');
 await page.getByLabel('Access code',{exact:true}).fill((await fs.readFile(path.join(workspace,'operator-key.txt'),'utf8')).trim());await page.getByRole('button',{name:'Open workspace',exact:true}).click();
 await page.locator('#source-formula-library').waitFor();await page.locator('[data-language-select]').selectOption('EN');
 await page.getByRole('link',{name:'Open Workbook Exchange',exact:true}).click();await page.locator('[data-language-select]').waitFor();await page.locator('[data-language-select]').selectOption('EN');await page.getByRole('heading',{name:'Workbook Exchange',exact:true}).waitFor();
 const programme=JSON.parse(await fs.readFile(path.join(workspace,'source-evidence/workbook-exchange-customer/complete-programme.json'),'utf8'));
 const original=programme.families[0].source_sha256;
 const book=()=>page.getByLabel('Retained workbook',{exact:true});
 await book().selectOption(original);await page.locator('#source-inspector .identity').getByText(original,{exact:true}).waitFor();
 const familyMappings=[];
 for(const family of programme.families){
  const selected=response('exchange_mapping',p=>p.questionnaire_id===family.questionnaire_id);
  await page.getByLabel('Saved definition',{exact:true}).selectOption(family.questionnaire_id);
  const mapped=(await (await selected).json()).result;
  check(mapped.questions.length===family.questions&&mapped.source_workbooks.includes(family.source_sha256),'The browser must open every complete original family mapping.');
  if(family.role==='producer')for(const qid of ['s_321ec7fb3a_5a2af601_b42_j42','s_321ec7fb3a_5a2af601_b43_j43','s_321ec7fb3a_5a2af601_b44_j44']){
   const question=mapped.questions.find(q=>q.question_id===qid);check(question.columns.find(c=>c.id==='c_b').kind==='text'&&question.columns.find(c=>c.id==='c_j').kind==='text','The actual domestic-producer English/French material-name inputs must remain text.');
  }
  familyMappings.push({role:family.role,questions:mapped.questions.length,source_sha256:family.source_sha256});
 }
 await note('all_five_complete_original_family_mappings',{families:familyMappings});
 const mappingSelected=response('exchange_mapping',p=>p.questionnaire_id===programme.families[0].questionnaire_id);
 await page.getByLabel('Saved definition',{exact:true}).selectOption(programme.families[0].questionnaire_id);await mappingSelected;
 const sheet=()=>page.locator('#source-inspector').getByLabel('Worksheet',{exact:true});
 await sheet().selectOption('Prod');await page.getByLabel('Cell range',{exact:true}).fill('C35:I38');
 const read=response('exchange_inspect',p=>p.sheet==='Prod'&&p.range==='C35:I38');await page.getByRole('button',{name:'Read range',exact:true}).click();await read;
 const c36=page.locator('#cell-grid tbody tr').filter({has:page.getByText('C36',{exact:true})});await c36.getByRole('button',{name:'Select',exact:true}).click();
 await page.getByLabel('New type',{exact:true}).selectOption('number');await page.getByLabel('New value',{exact:true}).fill('0');await page.getByRole('button',{name:'Add to reviewed edition',exact:true}).click();
 await page.locator('#selected-edits tbody').getByText('Prod!C36',{exact:true}).waitFor();
 await page.locator('[data-language-select]').selectOption('FR');await page.getByRole('heading',{name:'Échange de classeurs',exact:true}).waitFor();
 check(await page.getByLabel('Classeur conservé',{exact:true}).inputValue()===original&&await page.getByLabel('Nouvelle valeur',{exact:true}).inputValue()==='0'&&await page.getByLabel('Nouveau type',{exact:true}).inputValue()==='number','French display must preserve the actual reviewed original zero input.');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:960});const geometry=await page.evaluate(()=>({document_width:document.documentElement.scrollWidth}));
  result.widths.push({language:'FR',width,...geometry});check(geometry.document_width<=width+1,'The complete native exchange must fit its original viewport.');
  await page.screenshot({path:path.join(output,'exchange-FR-'+width+'.png'),fullPage:true});
 }
 await page.locator('[data-language-select]').selectOption('EN');await page.setViewportSize({width:1440,height:960});
 const downloads=[];page.on('download',download=>{downloads.push(download);});
 const exported=response('exchange_export',p=>p.sha256===original&&p.changes.some(c=>c.sheet==='Prod'&&c.cell==='C36'));
 await page.getByRole('button',{name:'Retain and download Excel edition',exact:true}).click();const received=(await (await exported).json()).result;
 await page.waitForFunction(sha=>document.querySelector('#source-inspector .identity')?.textContent===sha,received.sha256);
 while(downloads.length<2)await new Promise(resolve=>setTimeout(resolve,100));
 for(const download of downloads.splice(0)){await download.saveAs(path.join(output,download.suggestedFilename()));}
 const inputPath=path.join(output,received.name),bytes=await fs.readFile(inputPath);
 check(bytes.length===received.bytes,'The actual native browser downloaded the full successor workbook.');
 const actual=await post(page,'exchange_inspect',{sha256:received.sha256,sheet:'Prod',cells:['C36','C38']});
 check(actual.sheets[0].cells.C36.state==='number'&&actual.sheets[0].cells.C36.value==='0'&&actual.sheets[0].cells.C38.formula,'The browser zero edit must retain the original calculated cell.');
 await note('typed_zero_review_bilingual_display_and_complete_original_excel_download',{original_sha256:original,successor_sha256:received.sha256,bytes:received.bytes,cell:'Prod!C36',value:'0'});
 const file=page.getByLabel('Workbook',{exact:true});await page.getByText('Retain another complete XLSX edition',{exact:true}).click();await file.setInputFiles(inputPath);
 const imported=response('import_workbook');await page.getByRole('button',{name:'Retain workbook',exact:true}).click();const importedResult=(await (await imported).json()).result;check(importedResult.sha256===received.sha256,'The actual browser reimport must retain its exact original-format successor.');
 await page.waitForFunction(sha=>document.querySelector('#source-inspector .identity')?.textContent===sha,received.sha256);
 await book().selectOption(programme.families[0].native_binding.calculated_sha256);await page.waitForFunction(sha=>document.querySelector('#source-inspector .identity')?.textContent===sha,programme.families[0].native_binding.calculated_sha256);
 await page.getByLabel('Saved definition',{exact:true}).selectOption(programme.families[0].questionnaire_id);await page.getByRole('button',{name:'Read source mapping',exact:true}).click();
 await page.getByLabel('Formula value selection',{exact:true}).selectOption('cached');
 const extracted=response('exchange_extract');await page.getByRole('button',{name:'Extract mapped values and source states',exact:true}).click();const extraction=(await (await extracted).json()).result;
 check(extraction.cells.length===652&&extraction.computed_values.s_649106f345_5f56359e_c38==='150'&&extraction.validation.valid&&extraction.validation.formula_issues.length===29,'The customer browser must expose the real full source extraction, native150 and retained formula review.');
 await page.getByRole('heading',{name:'Extraction review',exact:true}).waitFor();
 const packageReceived=response('exchange_extract_package');await page.getByRole('button',{name:'Download Excel and complete source records',exact:true}).click();const register=(await (await packageReceived).json()).result;
 while(downloads.length<1)await new Promise(resolve=>setTimeout(resolve,100));for(const download of downloads.splice(0))await download.saveAs(path.join(output,download.suggestedFilename()));
 await note('real_native_edition_complete_four_sheet_register_and_formula_review',{source_cells:extraction.cells.length,native_total:'150',input_valid:extraction.validation.valid,original_formula_issues:29,register_bytes:register.bytes,register_sha256:register.sha256});
 const currentBook=programme.families[0].native_binding.calculated_sha256;
 let held=false;await page.route('**/api/invoke',async route=>{
  const request=route.request().postDataJSON();
  if(!held&&request.method==='exchange_inspect'&&request.params.sha256===original&&!request.params.sheet){held=true;const sourceResponse=await route.fetch();await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({response:sourceResponse});}
  else await route.continue();
 });
 await book().selectOption(original);await book().selectOption(programme.families[1].source_sha256);
 await page.waitForFunction(sha=>document.querySelector('#source-inspector .identity')?.textContent===sha,programme.families[1].source_sha256);
 await new Promise(resolve=>setTimeout(resolve,750));check(await page.locator('#source-inspector .identity').textContent()===programme.families[1].source_sha256,'A late actual source read must preserve the currently selected original workbook.');await page.unroute('**/api/invoke');
 const anonymous=await browser.newContext();const denied=await anonymous.request.post(launch.url+'/api/invoke',{headers:{Origin:launch.url},data:{method:'exchange_mapping',params:{questionnaire_id:programme.families[0].questionnaire_id}}});check(denied.status()===401,'Original operator source exchange remains scoped to the existing session.');await anonymous.close();
 const invite=JSON.parse(await fs.readFile(path.join(workspace,'respondent-'+programme.families[0].respondent_id+'.json'),'utf8'));
 const respondent=await browser.newContext();check((await respondent.request.post(launch.url+'/api/session',{headers:{Origin:launch.url},data:{role:'respondent',respondent_id:invite.respondent_id,access_code:invite.access_code}})).ok(),'The existing original respondent must open.');
 const forbidden=await respondent.request.post(launch.url+'/api/invoke',{headers:{Origin:launch.url},data:{method:'exchange_inspect',params:{sha256:original}}});check(forbidden.status()===403,'The original operator-only full source stays within its existing customer role.');await respondent.close();
 await page.reload();await page.getByRole('heading',{name:'Workbook Exchange',exact:true}).waitFor();await page.locator('#cell-grid table').waitFor();
 check(result.page_errors.length===0,'The complete original native exchange must finish without browser errors.');
 await note('actual_late_original_read_role_scopes_and_browser_reopen',{late_source_read_reconciled:held,workspace_id:launch.workspace_id});result.status='COMPLETE';
}catch(error){result.status='FAILED';result.error=error.stack||String(error);if(page)result.visible_state=await page.evaluate(()=>({notice:document.querySelector('#notice')?.textContent,labels:[...document.querySelectorAll('.field>span')].map(n=>n.textContent),language:document.querySelector('[data-language-select]')?.value})).catch(()=>null);throw error;}
finally{await fs.writeFile(path.join(output,'browser-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});await browser?.close();server.kill('SIGINT');}
console.log(JSON.stringify({status:result.status,workspace_id:result.workspace_id,steps:result.steps.length,page_errors:result.page_errors.length,widths:result.widths}));
