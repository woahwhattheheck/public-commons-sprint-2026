#!/usr/bin/env node
/* Operate the original formula library through its native customer browser. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const args=process.argv.slice(2),options={};
for(let n=0;n<args.length;n+=2){if(!args[n]?.startsWith('--')||!args[n+1])throw Error('Use --workspace PATH --output NEW_PATH [--python PYTHON --browser CHROME --playwright MODULE].');options[args[n].slice(2)]=args[n+1];}
if(!options.workspace||!options.output)throw Error('The original workspace and a new output directory are required.');
const source=path.dirname(fileURLToPath(import.meta.url)),workspace=path.resolve(options.workspace),output=path.resolve(options.output);
await fs.mkdir(output,{recursive:false,mode:0o700});
const module=options.playwright?pathToFileURL(path.resolve(options.playwright)).href:'playwright';
const {chromium}=await import(module);
const server=spawn(options.python||'python3',[path.join(source,'server.py'),'--workspace',workspace,'--port','0'],{stdio:['ignore','pipe','pipe']});
const record={schema:'atssc.original-formula-browser-operation.v1',started:new Date().toISOString(),steps:[],page_errors:[],widths:[]};
let browser,stderr='',operator;
server.stderr.on('data',data=>stderr+=data.toString());
const check=(condition,message)=>{if(!condition)throw Error(message);};
const note=async(name,value={})=>{record.steps.push({name,...value});await fs.writeFile(path.join(output,'browser-result.json'),JSON.stringify(record,null,2)+'\n',{mode:0o600});};
const rpc=async(page,method,params={})=>page.evaluate(async({method,params})=>{const response=await fetch('/api/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params:{request_id:crypto.randomUUID(),...params}})});const body=await response.json();if(!response.ok||body.error)throw Error(JSON.stringify(body.error||body));return body.result;},{method,params});
const counts=status=>Object.fromEntries(['workbooks','questionnaires','publications','respondents','reports'].map(key=>[key,status[key].length]));
try{
  let line='';const launch=await new Promise((resolve,reject)=>{server.stdout.on('data',chunk=>{line+=chunk;if(line.includes('\n')){try{resolve(JSON.parse(line.split('\n')[0]));}catch(error){reject(error);}}});server.once('error',reject);server.once('exit',code=>reject(Error('Native source server exited '+code+': '+stderr)));});
  record.workspace_id=launch.workspace_id;
  browser=await chromium.launch({headless:true,...(options.browser?{executablePath:options.browser}:{}),args:['--no-sandbox']});
  operator=await browser.newContext({viewport:{width:1440,height:960}});const page=await operator.newPage();page.on('pageerror',error=>record.page_errors.push(error.message));
  await page.goto(launch.url);await page.locator('[data-language-select]').selectOption('EN');
  await page.getByLabel('Access code',{exact:true}).fill((await fs.readFile(path.join(workspace,'operator-key.txt'),'utf8')).trim());await page.getByRole('button',{name:'Open workspace',exact:true}).click();
  await page.locator('#source-formula-library').waitFor();const preference=await rpc(page,'language.get_preference');
  await page.locator('[data-language-select]').selectOption('EN');await page.getByRole('heading',{name:'Original formula library',exact:true}).waitFor();
  const before=counts(await rpc(page,'status')),collection=await rpc(page,'source_formula_inspect');
  check(collection.ready&&collection.workbooks.length===5&&collection.totals.formula_occurrences===7661&&collection.totals.native_formula_joins===7661,'Open the complete original five-workbook native formula library.');
  const library=page.locator('#source-formula-library');await library.getByText('Complete original collection is retained.',{exact:true}).waitFor();
  check(await library.locator('tbody').first().locator('tr').count()===30,'The first source page must contain 30 complete groups.');
  await library.getByRole('button',{name:'Next',exact:true}).click();await library.getByText(/matching groups · 31–60/).waitFor();
  await library.getByRole('button',{name:'Previous',exact:true}).click();await library.getByText(/matching groups · 1–30/).waitFor();
  await note('complete_original_collection_and_source_pagination',{formula_occurrences:7661,groups:collection.totals.workbook_structural_groups,native_jobs:collection.native_jobs.length});
  const first=collection.workbooks.find(book=>book.role==='foreign_producer');check(first,'The original foreign-producer workbook must be retained.');
  const nativeProgramme=JSON.parse(await fs.readFile(path.join(workspace,'source-evidence/formula-library/complete-programme.json'),'utf8'));
  const originalCell=await rpc(page,'source_formula_cell',{collection_id:collection.collection_id,workbook_sha256:first.source.sha256,source_key:nativeProgramme.original_c38_source_key});
  const worksheet=originalCell.cell.worksheet,cellName=worksheet+'!'+originalCell.cell.cell;
  await library.getByLabel('Original workbook',{exact:true}).selectOption(first.source.sha256);await library.getByLabel('Original worksheet',{exact:true}).selectOption(worksheet);
  const search=library.getByLabel('Search source groups',{exact:true});const filtered=page.waitForResponse(r=>r.url().endsWith('/api/invoke')&&r.request().postDataJSON()?.method==='source_formula_groups'&&r.request().postDataJSON()?.params?.search==='C38');await search.fill('C38');await filtered;
  await library.getByText('Complete original collection is retained.',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#source-formula-library tbody tr button')&&document.querySelector('#source-formula-library input[type=search]').value==='C38');
  await library.locator('tbody').first().locator('button').first().click();await library.getByLabel('Retained native calculation edition',{exact:true}).waitFor();
  const detail=library.locator('section').last();await detail.getByRole('button',{name:cellName,exact:true}).click();await detail.getByRole('heading',{name:cellName,exact:true}).waitFor();
  const cell=()=>detail.locator('pre').evaluate(node=>JSON.parse(node.textContent));let value=await cell();check(value.cell.cell==='C38'&&value.cell.native,'The complete source cell and original native cache must be visible.');
  const edition=detail.getByLabel('Retained native calculation edition',{exact:true});const jobs=await edition.locator('option').evaluateAll(nodes=>nodes.filter(node=>node.value).map(node=>node.value));check(jobs.length>1,'Retained successor editions must be selectable.');
  const selected=jobs.slice(0,3),native=[];
  for(const id of selected){const response=page.waitForResponse(r=>r.url().endsWith('/api/invoke')&&r.request().postDataJSON()?.method==='source_formula_cell'&&r.request().postDataJSON()?.params?.calculation_id===id);await edition.selectOption(id);await response;await page.waitForFunction(id=>{const p=document.querySelector('#source-formula-library pre');if(!p)return false;try{return JSON.parse(p.textContent).selected_native_edition?.calculation_id===id;}catch{return false;}},id);value=await cell();native.push({calculation_id:id,kind:value.selected_native_edition.kind,value:value.selected_native_edition.value});}
  const chosen=await edition.inputValue();await page.locator('[data-language-select]').selectOption('FR');await library.getByRole('heading',{name:'Bibliothèque des formules originales',exact:true}).waitFor();
  check(await library.getByLabel('Classeur original',{exact:true}).inputValue()===first.source.sha256&&await library.getByLabel('Feuille originale',{exact:true}).inputValue()===worksheet&&await library.getByLabel('Rechercher les groupes sources',{exact:true}).inputValue()==='C38'&&await detail.getByLabel('Édition native de calcul conservée',{exact:true}).inputValue()===chosen,'Language changes must preserve source filters and the selected native edition.');
  for(const width of [1440,390]){await page.setViewportSize({width,height:960});const dimensions=await page.evaluate(()=>({document_width:document.documentElement.scrollWidth,outside:[...document.querySelectorAll('#source-formula-library *')].map(node=>({tag:node.tagName,class:node.className,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right})).filter(node=>node.right>innerWidth+1||node.left<0).slice(0,25)}));record.widths.push({language:'FR',width,...dimensions});await page.screenshot({path:path.join(output,'formula-FR-'+width+'.png'),fullPage:true});check(dimensions.document_width<=width+1,'The formula workbench must fit its native viewport.');}
  await note('source_cell_successor_editions_and_bilingual_filter_preservation',{worksheet,cell:originalCell.cell.cell,native_editions:native});
  await page.locator('[data-language-select]').selectOption('EN');await page.setViewportSize({width:1440,height:960});
  await library.getByLabel('Original worksheet',{exact:true}).selectOption('');
  const inputQuestion=nativeProgramme.original_entered_question_id,inputQuery=page.waitForResponse(r=>r.url().endsWith('/api/invoke')&&r.request().postDataJSON()?.method==='source_formula_groups'&&r.request().postDataJSON()?.params?.search===inputQuestion);
  await library.getByLabel('Search source groups',{exact:true}).fill(inputQuestion);const inputGroups=(await (await inputQuery).json()).result;
  check(inputGroups.total===nativeProgramme.input_question_group_count&&inputGroups.groups.some(group=>group.group_key===nativeProgramme.original_c38_group_key),'The original entered input must find its complete native consumer groups.');
  await library.locator('tbody').first().getByRole('button',{name:new RegExp(nativeProgramme.original_c38_group_key.slice(0,12))}).click();await library.locator('section').last().getByRole('button',{name:cellName,exact:true}).click();await library.locator('section').last().getByRole('heading',{name:cellName,exact:true}).waitFor();
  const consumer=await library.locator('section').last().locator('pre').evaluate(node=>JSON.parse(node.textContent));check(consumer.cell.native_question_references.some(binding=>binding.question_id===inputQuestion&&binding.cell==='C36'),'The actual C38 consumer must retain the exact declared original C36 input binding.');
  await note('original_entered_input_to_complete_native_formula_consumers',{input_question_id:inputQuestion,consumer_groups:inputGroups.total,source_cell:'Prod!C36',consumer_cell:cellName});
  const unrelated=await browser.newContext();const anonymous=await unrelated.newPage();const denied=await anonymous.request.post(launch.url+'/api/invoke',{headers:{Origin:launch.url},data:{method:'source_formula_inspect',params:{}}});check(denied.status()===401,'The original formula collection requires an operator session.');await unrelated.close();
  const invitations=(await fs.readdir(workspace)).filter(name=>/^respondent-.*\.json$/.test(name));check(invitations.length,'Retain the original customer invitations.');const invitation=JSON.parse(await fs.readFile(path.join(workspace,invitations[0]),'utf8'));
  const restricted=await browser.newContext();const responsePage=await restricted.newPage();check((await responsePage.request.post(launch.url+'/api/session',{headers:{Origin:launch.url},data:{role:'respondent',respondent_id:invitation.respondent_id,access_code:invitation.access_code}})).ok(),'The retained original respondent entry must open.');const forbidden=await responsePage.request.post(launch.url+'/api/invoke',{headers:{Origin:launch.url},data:{method:'source_formula_groups',params:{collection_id:collection.collection_id}}});check(forbidden.status()===403,'Original source formula inspection stays scoped to operators.');await restricted.close();
  await page.getByRole('button',{name:'Definitions',exact:true}).click();await page.getByRole('heading',{name:'Original formula library',exact:true}).waitFor({state:'detached'});await page.getByRole('button',{name:'Workbooks',exact:true}).click();await page.getByRole('heading',{name:'Original formula library',exact:true}).waitFor();await page.locator('#source-formula-library').getByText('Complete original collection is retained.',{exact:true}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'Original formula library',exact:true}).waitFor();await page.locator('#source-formula-library').getByText('Complete original collection is retained.',{exact:true}).waitFor();
  const reopened=await rpc(page,'source_formula_inspect');check(reopened.collection_id===collection.collection_id&&reopened.native_jobs.length===collection.native_jobs.length,'A browser reopening must retain the exact original source collection and native jobs.');
  check(JSON.stringify(counts(await rpc(page,'status')))===JSON.stringify(before),'Formula inspection must retain original workbook/questionnaire/respondent/report counts.');
  if(preference.language==='FR')await page.locator('[data-language-select]').selectOption('FR');
  check(record.page_errors.length===0,'The complete original formula browser must have no page errors.');await note('role_scope_mount_cleanup_browser_reopen_and_original_state_preserved',{collection_id:collection.collection_id,counts:before});
  record.status='COMPLETE';record.completed=new Date().toISOString();
}catch(error){record.status='FAILED';record.error=error.stack||String(error);throw error;}
finally{await fs.writeFile(path.join(output,'browser-result.json'),JSON.stringify(record,null,2)+'\n',{mode:0o600});await browser?.close();server.kill('SIGINT');}
console.log(JSON.stringify({status:record.status,workspace_id:record.workspace_id,steps:record.steps.length,page_errors:record.page_errors.length,widths:record.widths}));
