#!/usr/bin/env node
// MIT. One complete original-source, operator, browser and receiving journey.
import {mkdir,readFile,open,rename} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startOpportunityWorkspace} from './server.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const execute=promisify(execFile);
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const copy=value=>structuredClone(value);
const OPERATION='LGNDX-OPPORTUNITY-OPERATIONS-0C7A-20261012';
const fail=(message,code='RECEIVING_ERROR')=>{throw Object.assign(new Error(message),{code});};
function requireThat(ok,message,code){if(!ok)fail(message,code);}
function parse(args){
  const result={};
  for(let i=0;i<args.length;i++){
    requireThat(args[i].startsWith('--'),'Use named receiving options');
    const key=args[i].slice(2),value=args[++i];
    requireThat(value!==undefined&&!value.startsWith('--'),'Missing --'+key+' value');
    result[key]=value;
  }
  return result;
}
async function write(path,bytes){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.tmp-'+randomUUID();
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  await rename(temporary,path);
  const directory=await open(dirname(path),'r');
  try{await directory.sync();}finally{await directory.close();}
  return {path,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)};
}
async function readOptional(path){
  try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function reference(source,locator,excerpt){
  return {sourceId:source.id,locator,...(excerpt?{excerpt}:{})};
}
function stableEvidence(items){return (items||[]).map(item=>({sourceId:item.sourceId,locator:item.locator,...(item.excerpt?{excerpt:item.excerpt}:{})}));}
async function sourceEdition(sourceRef){
  const names=[
    'model.mjs','model.d.mts','sources.mjs','package.mjs','server.mjs','server.d.mts',
    'cli.mjs','cli.d.mts','receive.mjs','README.md','web/index.html','web/style.css','web/app.js',
    'references/operator-seed.json','references/response-workbook.json','references/source-manifest.json',
    '../../sf88-operator-buyer-cli/node/store.mjs',
    '../../sf88-operator-buyer-cli/research-dossiers/dossier.mjs',
    '../../sf88-operator-buyer-cli/research-dossiers/normalize.mjs',
    '../../sf88-operator-buyer-cli/research-dossiers/report.mjs',
    '../../sf30-seller-sdk/usaspending/core.mjs',
    '../../sf30-seller-sdk/usaspending/dossier.mjs',
  ];
  const files=[];
  for(const path of names){const bytes=await readFile(resolve(HERE,path));files.push({path,bytes:bytes.length,sha256:sha(bytes)});}
  return {sourceRef:sourceRef||'',root:HERE,files,sha256:sha(json(files)),observedAt:new Date().toISOString()};
}

export async function receiveOpportunityOperation(options={}){
  requireThat(options.directory,'--directory is required');
  const directory=resolve(options.directory),operator=options.operator||'Integration receiver';
  const originalDirectory=join(directory,'original-workspace');
  const receivingDirectory=join(directory,'receiving-workspace');
  const outputDirectory=join(directory,'handoff');
  const journalPath=join(directory,'operation.json');
  await mkdir(directory,{recursive:true,mode:0o700});
  let journal=await readOptional(journalPath);
  if(journal)requireThat(journal.operation===OPERATION&&journal.operator===operator,'Reopen with the original operation and operator');
  else journal={schema:'stellar-forge.opportunity-receiving.v1',operation:OPERATION,operator,
    directory,originalDirectory,receivingDirectory,createdAt:new Date().toISOString(),
    status:'running',sourceEditions:[],stages:{},actions:{},observations:[],context:{},artifacts:[]};
  const save=async()=>{journal.updatedAt=new Date().toISOString();await write(journalPath,json(journal));};
  const edition=await sourceEdition(options['source-ref']);
  if(!journal.sourceEditions.some(item=>item.sha256===edition.sha256&&item.sourceRef===edition.sourceRef)){
    journal.sourceEditions.push(edition);await save();
  }
  if(journal.status==='complete')return {operation:OPERATION,status:'complete',journalPath,...journal.context.result};
  let host=null,receiver=null,browser=null;
  async function checkpoint(){
    if(!options.checkpoint)return;
    const target=resolve(options.checkpoint);
    requireThat(!target.startsWith(directory+'/'),'Keep the checkpoint archive outside the operating directory','CHECKPOINT_PATH_INVALID');
    await mkdir(dirname(target),{recursive:true,mode:0o700});
    const temporary=target+'.tmp-'+randomUUID();
    await execute('tar',['-czf',temporary,'-C',directory,'.'],{maxBuffer:1024*1024});
    await rename(temporary,target);
  }
  async function stage(key,work){
    if(journal.stages[key]?.status==='complete')return journal.stages[key].result;
    const entry=journal.stages[key]||{startedAt:new Date().toISOString()};
    journal.stages[key]={...entry,status:'running'};await save();
    try{
      const result=await work();
      journal.stages[key]={...entry,status:'complete',completedAt:new Date().toISOString(),result};
      await save();await checkpoint();process.stdout.write(json({operation:OPERATION,stage:key,status:'complete',result}));
      return result;
    }catch(error){
      journal.stages[key]={...entry,status:'error',failedAt:new Date().toISOString(),error:{code:error.code||'RECEIVING_ERROR',message:error.message}};
      journal.status='interrupted';await save();await checkpoint().catch(checkpointError=>process.stderr.write(json({checkpointError:checkpointError.message})));throw error;
    }
  }
  async function cli(args){
    const result=await execute(process.execPath,[join(HERE,'cli.mjs'),...args],{cwd:HERE,maxBuffer:128*1024*1024});
    const parsed=JSON.parse(result.stdout);
    journal.observations.push({kind:'cli',command:args[0],at:new Date().toISOString(),
      stdoutBytes:Buffer.byteLength(result.stdout),stdoutSha256:sha(result.stdout),
      stderrBytes:Buffer.byteLength(result.stderr)});
    await save();return parsed;
  }
  async function request(active,path,{method='GET',body,authenticated=true,raw=false}={}){
    const payload=body===undefined?undefined:JSON.stringify(body);
    const token=new URL(active.url).hash.slice('#token='.length);
    const response=await fetch(active.origin+path,{
      method,headers:{Connection:'close',...(authenticated?{Authorization:'Bearer '+token}:{}),
        ...(payload===undefined?{}:{'Content-Type':'application/json'})},body:payload,
      signal:AbortSignal.timeout(120000),
    });
    const bytes=Buffer.from(await response.arrayBuffer());
    journal.observations.push({kind:'http',method,path,status:response.status,
      requestBytes:payload===undefined?0:Buffer.byteLength(payload),responseBytes:bytes.length,
      responseSha256:sha(bytes),at:new Date().toISOString()});
    if(raw)return {status:response.status,bytes,headers:Object.fromEntries(response.headers)};
    let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail('The operator returned non-JSON for '+path,'OPERATOR_RESPONSE');}
    if(!response.ok)fail(value.message||value.error||'HTTP '+response.status,value.error||'HTTP_'+response.status);
    return value;
  }
  const current=()=>request(host,'/api/projects/'+journal.context.projectId);
  async function action(key,name,build){
    if(journal.actions[key]?.status==='complete')return current();
    let entry=journal.actions[key];
    if(!entry){
      const project=await current();
      const payload={...await build(project),id:project.id,expectedRevision:project.revision,
        requestId:'receiving-'+sha(OPERATION+':'+key).slice(0,48)};
      entry={status:'prepared',name,payload,preparedAt:new Date().toISOString()};
      journal.actions[key]=entry;await save();
    }
    const result=await request(host,'/api/dispatch',{method:'POST',body:{action:entry.name,payload:entry.payload}});
    journal.actions[key]={...entry,status:'complete',projectId:result.id,revision:result.revision,
      completedAt:new Date().toISOString(),resultSha256:sha(json(result))};
    await save();return result;
  }
  async function artifact(filename,bytes){
    const result=await write(join(outputDirectory,filename),bytes);
    const previous=journal.artifacts.findIndex(item=>item.path===result.path);
    if(previous>=0)journal.artifacts[previous]=result;else journal.artifacts.push(result);
    await save();return result;
  }
  async function sourceBytes(active,project,source){
    const result=await request(active,'/api/dispatch',{method:'POST',body:{action:'read_source',payload:{id:project.id,sourceId:source.id}}});
    const bytes=Buffer.from(result.contentBase64,'base64');
    requireThat(bytes.length===source.bytes&&sha(bytes)===source.sha256,'Source bytes changed: '+source.filename,'SOURCE_BYTES_CHANGED');
    return {id:source.id,bytes:bytes.length,sha256:sha(bytes)};
  }
  async function exports(active,projectId,packageId,prefix){
    const files=[];
    for(const format of ['portable','html','markdown','requirements','capabilities','teaming','milestones','questions']){
      const response=await request(active,'/api/projects/'+projectId+'/export?'+new URLSearchParams({format,packageId}),{raw:true});
      requireThat(response.status===200,'Export failed: '+format,'EXPORT_FAILED');
      const suffix=format==='portable'?'.json':format==='html'?'.html':format==='markdown'?'.md':'.csv';
      const retained=['original-review','current-receiving'].includes(prefix);
      files.push({format,...(retained?await artifact(prefix+'-'+format+suffix,response.bytes):{filename:prefix+'-'+format+suffix,bytes:response.bytes.length,sha256:sha(response.bytes)})});
    }
    return files;
  }
  async function browserReceiving(project){
    requireThat(options.playwright&&options.browser,'Browser receiving requires the existing --playwright and --browser paths','BROWSER_PATHS_REQUIRED');
    const playwright=await import(pathToFileURL(resolve(options.playwright)).href);
    browser=await playwright.chromium.launch({executablePath:resolve(options.browser),headless:true,
      args:['--no-sandbox','--disable-dev-shm-usage']});
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(host.url,{waitUntil:'networkidle'});
    await page.waitForSelector('#project-header h1');
    const views=[];
    for(const tab of ['overview','sources','capabilities','requirements','team','questions','packages','history']){
      await page.locator('[data-tab="'+tab+'"]').click();
      await page.waitForFunction(()=>!document.querySelector('#busy-indicator')?.hidden?false:true);
      views.push({tab,title:await page.locator('#project-header h1').textContent(),
        contentCharacters:(await page.locator('#panel').textContent()).length});
    }
    await page.locator('[data-tab="sources"]').click();
    const originalSource=project.sources.find(item=>item.filename==='mcc-rfi-government-text.txt');
    await page.locator('[data-action="view-source"][data-id="'+originalSource.id+'"]').first().click();
    await page.waitForSelector('#source-viewer[open]');
    const viewedText=await page.locator('.source-content').textContent();
    requireThat(sha(viewedText)===originalSource.sha256,'Browser original-source viewer changed the retained text','BROWSER_SOURCE_CHANGED');
    await page.locator('[data-action="close-source"]').first().click();
    await page.locator('[data-tab="questions"]').click();
    const receivingQuestion=project.questions.find(item=>item.number==='INTEGRATION-RECEIVING');
    requireThat(receivingQuestion,'Receiving question must be present');
    const targetOwner=operator+' — browser receiving';
    const newest=await current();
    if(newest.questions.find(item=>item.id===receivingQuestion.id)?.owner!==targetOwner){
      journal.context.browserPrepared={questionId:receivingQuestion.id,owner:targetOwner,preparedAt:new Date().toISOString()};await save();
      await page.locator('[data-action="edit-question"][data-id="'+receivingQuestion.id+'"]').click();
      await page.waitForSelector('#editor[open]');
      await page.locator('#field-owner').fill(targetOwner);
      await page.locator('#editor-save').click();
      await page.locator('#editor').waitFor({state:'hidden'});
    }
    const after=await current();
    requireThat(after.questions.find(item=>item.id===receivingQuestion.id)?.owner===targetOwner,'The actual browser question edit was not retained','BROWSER_EDIT_MISSING');
    await page.locator('[data-tab="packages"]').click();
    const frozenId=journal.context.firstPackageId;
    const downloadButton=page.locator('[data-action="export-package"][data-id="'+frozenId+'"][data-format="html"]');
    const downloaded=page.waitForEvent('download');
    await downloadButton.click();const download=await downloaded;
    const browserFile=join(outputDirectory,'browser-original-handoff.html');await download.saveAs(browserFile);
    const browserBytes=await readFile(browserFile);
    const original=journal.context.firstFiles.find(item=>item.format==='html');
    requireThat(sha(browserBytes)===original.sha256,'Named browser download changed after source review','BROWSER_NAMED_EXPORT_CHANGED');
    await page.locator('[data-tab="overview"]').click();
    const desktopPath=join(directory,'desktop.png');await page.screenshot({path:desktopPath,fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-tab="requirements"]').click();
    const mobileWidth=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    requireThat(mobileWidth.document<=mobileWidth.viewport+1,'The mobile operator overflows the viewport','BROWSER_LAYOUT_OVERFLOW');
    const mobilePath=join(directory,'mobile.png');await page.screenshot({path:mobilePath,fullPage:true});
    requireThat(errors.length===0,'Browser page errors: '+errors.join('; '),'BROWSER_PAGE_ERROR');
    await context.close();await browser.close();browser=null;
    return {views,questionId:receivingQuestion.id,revision:after.revision,sourceSha256:sha(viewedText),
      originalNamedHtmlSha256:sha(browserBytes),desktopPath,mobilePath,mobileWidth,pageErrors:errors};
  }
  try{
    journal.status='running';await save();
    await stage('01-complete-original-source-intake',async()=>{
      const result=await cli(['seed','--workspace',originalDirectory,'--operator',operator]);
      requireThat(result.sources===7&&result.requirements===34&&result.capabilities===3&&result.questions===2,
        'The complete seven-source /34-item seed did not enter the original workspace','INCOMPLETE_SEED');
      journal.context.projectId=result.projectId;await save();return result;
    });
    host=await startOpportunityWorkspace({directory:originalDirectory,operator});
    await stage('02-original-http-source-and-company-review',async()=>{
      const initial=await current();
      const denied=await request(host,'/api/projects',{authenticated:false,raw:true});
      requireThat(denied.status===401,'The original operator token must be required','AUTHORITY_CHANGED');
      const sourceReads=[];
      for(const source of initial.sources)sourceReads.push(await sourceBytes(host,initial,source));
      const workbookText=await readFile(join(HERE,'references','response-workbook.json'),'utf8');
      const workbook=JSON.parse(workbookText);
      const rows=Array.isArray(workbook)?workbook:(workbook.responses||workbook.requirements||workbook.rows);
      requireThat(Array.isArray(rows)&&rows.length===34,'The complete response workbook needs all34 original requirement numbers','WORKBOOK_INCOMPLETE');
      requireThat(new Set(rows.map(item=>item.number)).size===34&&initial.requirements.every(item=>rows.some(row=>row.number===item.number)),
        'The response workbook must preserve the original requirement numbers','WORKBOOK_REQUIREMENTS_CHANGED');
      const authored=await action('retain-response-workbook','retain_source',async()=>({
        role:'other',title:'Opportunity response and receiving implementation workbook',
        capturedAt:new Date().toISOString(),filename:'response-workbook.json',mediaType:'application/json',
        contentText:workbookText,sourceTerms:'Original TokenJunkies implementation recommendations and company-review work items.'
      }));
      const source=authored.sources.find(item=>item.sha256===sha(workbookText));
      journal.context.workbookSourceId=source.id;journal.context.workbook=rows;await save();
      for(const capability of initial.capabilities){
        await action('review-published-'+capability.id,'save_capability',async()=>({
          capabilityId:capability.id,status:'reviewed',owner:operator,
          deliveryStatus:'unspecified',
        }));
      }
      const project=await current();
      return {projectId:project.id,revision:project.revision,sourceReads,workbookSourceId:source.id,companyRecords:project.capabilities.length};
    });
    await stage('03-complete-response-team-plan-and-questions',async()=>{
      let project=await action('integration-team','save_team',async p=>({
        name:'Opportunity integration delivery team',role:'Community pipeline and response receiving',
        decision:'considering',owner:operator,
        scope:'Map one existing community pipeline into retained company/opportunity/requirements work, team scope and a complete receiving exchange.',
        capabilityIds:p.capabilities.map(item=>item.id),requirementIds:p.requirements.filter(item=>['2','8','13.a','14.a'].includes(item.number)).map(item=>item.id),
        note:'Proposed implementation role; participating company and partner delivery references are gathered for the individual experience questions.',
        evidence:[reference(p.sources.find(item=>item.id===journal.context.workbookSourceId),'Complete authored implementation workbook')],
      }));
      const team=project.teaming.find(item=>item.name==='Opportunity integration delivery team');
      journal.context.teamId=team.id;await save();
      for(const row of journal.context.workbook){
        const requirement=project.requirements.find(item=>item.number===row.number);
        project=await action('requirement-work-'+row.number,'save_requirement',async()=>({
          requirementId:requirement.id,owner:row.owner||operator,
          responseDisposition:row.responseDisposition||'unanswered',status:row.status||'open',
        }));
        project=await action('coverage-work-'+row.number,'save_coverage',async p=>({
          requirementId:requirement.id,decision:row.decision||'gap',owner:row.owner||operator,
          response:row.response||'',reviewNote:row.reviewNote||'',
          capabilityIds:[],teamIds:row.decision==='team_required'?[team.id]:[],
          evidence:[...stableEvidence(requirement.evidence),
            reference(p.sources.find(item=>item.id===journal.context.workbookSourceId),'Response workbook item '+row.number)],
        }));
      }
      const milestones=[
        {key:'source-intake',title:'Retain original notice, questionnaire and company research',dueAt:'2026-10-12T16:00:00Z',status:'done',depends:[]},
        {key:'pipeline-mapping',title:'Confirm the existing pipeline fields and receiving exchange',dueAt:'2026-10-14T16:00:00Z',status:'open',depends:['source-intake']},
        {key:'company-input',title:'Join company identity, vehicles and delivered-work references',dueAt:'2026-10-16T16:00:00Z',status:'open',depends:['source-intake']},
        {key:'response-review',title:'Review the complete numbered response and team inputs',dueAt:'2026-10-20T16:00:00Z',status:'open',depends:['pipeline-mapping','company-input']},
        {key:'handoff-review',title:'Complete receiving review and named response handoff',dueAt:'2026-10-22T16:00:00Z',status:'open',depends:['response-review']},
        {key:'issued-response-window',title:'MCC issued response window',dueAt:'2026-10-29T22:00:00Z',status:'open',depends:['handoff-review']},
      ];
      journal.context.milestoneIds=journal.context.milestoneIds||{};
      for(const item of milestones){
        project=await action('milestone-'+item.key,'save_milestone',async p=>({
          title:item.title,owner:operator,dueAt:item.dueAt,timeZone:'America/New_York',
          status:item.status,dependsOn:item.depends.map(key=>journal.context.milestoneIds[key]),
          requirementIds:p.requirements.map(row=>row.id),
          note:item.key==='issued-response-window'?'Issued SAM response timestamp retained with its original source; project remains in research.':'Internal implementation working milestone.',
          evidence:[reference(p.sources.find(row=>row.filename==='mcc-notice-record.json'),'Notice response timestamp and original URL')],
        }));
        journal.context.milestoneIds[item.key]=project.milestones.find(row=>row.title===item.title).id;await save();
      }
      project=await action('receiving-question','save_question',async p=>({
        number:'INTEGRATION-RECEIVING',text:'Which complete local exchange carries this opportunity into the receiving operator?',
        owner:operator,status:'answered',answer:'The portable opportunity packet carries the complete project revisions, original source dossier, named handoff snapshots, requirement responses, capabilities, teaming, milestones and Q&A. The receiving workspace imports and reopens that same project identity.',
        requirementIds:p.requirements.filter(item=>['2','13.a'].includes(item.number)).map(item=>item.id),
        evidence:[reference(p.sources.find(item=>item.id===journal.context.workbookSourceId),'Authored receiving and response implementation workbook')],
      }));
      requireThat(project.coverage.length===34&&project.milestones.length===6&&project.questions.length===3,
        'The complete operating response, plan and Q&A must be retained','OPERATING_RECORD_INCOMPLETE');
      const ai=project.requirements.find(item=>item.number==='6');
      requireThat(ai.evidenceRule==='deployed_only'&&project.coverage.find(item=>item.requirementId===ai.id).decision!=='supported',
        'The deployed-experience item must retain the actual company-review state','DEPLOYED_RULE_CHANGED');
      return {projectId:project.id,revision:project.revision,requirements:project.requirements.length,
        coverage:project.coverage.length,teaming:project.teaming.length,milestones:project.milestones.length,questions:project.questions.length};
    });
    await stage('04-freeze-original-complete-review-handoff',async()=>{
      const project=await action('first-review-package','create_package',async()=>({
        title:'Complete opportunity response and receiving review — original edition',
        status:'ready_for_review',note:'All original numbered requirements, proposed engineering responses and actual company-review work travel with their sources, owners, plan and Q&A.',
      }));
      const selected=project.packages.find(item=>item.title==='Complete opportunity response and receiving review — original edition');
      journal.context.firstPackageId=selected.id;journal.context.firstRevision=selected.sourceRevision;await save();
      const firstFiles=await exports(host,project.id,selected.id,'original-review');
      journal.context.firstFiles=firstFiles;await save();
      return {projectId:project.id,packageId:selected.id,reviewedRevision:selected.sourceRevision,files:firstFiles};
    });
    await stage('05-authored-exchange-revision-and-source-review',async()=>{
      const original=JSON.parse(await readFile(join(HERE,'references','response-workbook.json'),'utf8'));
      const replacement=Array.isArray(original)?{responses:original}:copy(original);
      replacement.receivingExchange={
        revision:2,kind:'operator-authored receiving mapping',
        projectIdentity:'project.id',sourceIdentity:'sources[].id + sha256',
        requirementIdentity:'requirements[].number + id',coverage:'coverage[].requirementId',
        receivingFiles:['handoff.html','handoff.md','requirements.csv','capabilities.csv','teaming.csv','milestones.csv','questions.csv'],
        review:'Existing customer field names are mapped at kickoff; the portable project preserves the complete original operating history.',
      };
      const contentText=json(replacement);
      let project=await action('retain-exchange-revision','retain_source',async()=>({
        role:'other',title:'Opportunity response and receiving implementation workbook — exchange revision 2',
        capturedAt:new Date().toISOString(),filename:'response-workbook-exchange-v2.json',mediaType:'application/json',
        contentText,replacesSourceId:journal.context.workbookSourceId,
        sourceTerms:'Original TokenJunkies authored receiving exchange revision and existing response workbook.',
      }));
      const source=project.sources.find(item=>item.sha256===sha(contentText));
      const change=project.changes.find(item=>item.beforeSourceId===journal.context.workbookSourceId&&item.afterSourceId===source.id);
      requireThat(change&&change.affectedIds.length>=34,'The source revision must identify the actual linked response reviews','SOURCE_CHANGE_LINKS_MISSING');
      journal.context.exchangeSourceId=source.id;journal.context.changeId=change.id;await save();
      project=await action('review-exchange-revision','review_change',async()=>({
        changeId:change.id,status:'reviewed',decision:'Adopt the explicit receiving field mapping',
        note:'The authored revision defines the project, source, requirement and coverage joins for receiving. The issued government source files and existing response recommendations remain intact; each numbered response retains its original source-bound review.',
        affectedIds:change.affectedIds,
      }));
      const comparison=await request(host,'/api/dispatch',{method:'POST',body:{
        action:'compare',payload:{id:project.id,before:journal.context.firstRevision,after:project.revision},
      }});
      requireThat(comparison.sources.added.some(item=>item.id===source.id),'Historical comparison must include the actual new source edition','SOURCE_COMPARISON_MISSING');
      const originalFiles=await exports(host,project.id,journal.context.firstPackageId,'reopened-original-review');
      for(const file of originalFiles){
        const before=journal.context.firstFiles.find(item=>item.format===file.format);
        requireThat(before.sha256===file.sha256,'Frozen original handoff changed: '+file.format,'FROZEN_EXPORT_CHANGED');
      }
      await artifact('source-revision-comparison.json',Buffer.from(json(comparison)));
      return {revision:project.revision,changeId:change.id,affectedRecords:change.affectedIds.length,
        previousSourceId:journal.context.workbookSourceId,currentSourceId:source.id,
        originalNamedFiles:originalFiles.map(item=>({format:item.format,sha256:item.sha256}))};
    });
    if(options.playwright||options.browser){
      await stage('06-native-browser-operator-and-named-download',async()=>browserReceiving(await current()));
    }
    await stage('07-complete-current-receiving-package',async()=>{
      const project=await action('final-receiving-package','create_package',async()=>({
        title:'Complete opportunity response and receiving handoff — exchange revision 2',
        status:'ready_for_review',note:'Includes the original complete questionnaire, company review, proposed responses, team and dependent plan, source-change review, Q&A and receiving field mapping.',
      }));
      const selected=project.packages.find(item=>item.title==='Complete opportunity response and receiving handoff — exchange revision 2');
      journal.context.finalPackageId=selected.id;journal.context.finalRevision=project.revision;await save();
      const currentFiles=await exports(host,project.id,selected.id,'current-receiving');
      journal.context.currentFiles=currentFiles;journal.context.portablePath=currentFiles.find(item=>item.format==='portable').path;await save();
      return {projectId:project.id,revision:project.revision,packageId:selected.id,files:currentFiles};
    });
    await host.close();host=null;
    await stage('08-original-command-reopen-and-fresh-http-receiving',async()=>{
      const reopened=await cli(['show','--workspace',originalDirectory,'--operator',operator,'--id',journal.context.projectId]);
      requireThat(reopened.revision===journal.context.finalRevision,'Original command reopen changed the final project revision','ORIGINAL_REOPEN_CHANGED');
      receiver=await startOpportunityWorkspace({directory:receivingDirectory,operator});
      const packet=JSON.parse(await readFile(journal.context.portablePath,'utf8'));
      const received=await request(receiver,'/api/receive',{method:'POST',body:{packet}});
      const repeated=await request(receiver,'/api/receive',{method:'POST',body:{packet}});
      requireThat(received.id===reopened.id&&received.revision===reopened.revision&&repeated.revision===received.revision,
        'Fresh and repeated receiving must preserve the original project and revision','RECEIVING_IDENTITY_CHANGED');
      const retained=[];
      for(const source of received.sources)retained.push(await sourceBytes(receiver,received,source));
      const firstFiles=await exports(receiver,received.id,journal.context.firstPackageId,'received-original-review');
      for(const file of firstFiles)requireThat(file.sha256===journal.context.firstFiles.find(item=>item.format===file.format).sha256,
        'Fresh receiving changed a named original file: '+file.format,'RECEIVED_NAMED_EXPORT_CHANGED');
      const finalFiles=await exports(receiver,received.id,journal.context.finalPackageId,'received-current-review');
      for(const file of finalFiles)requireThat(file.sha256===journal.context.currentFiles.find(item=>item.format===file.format).sha256,
        'Fresh receiving changed the final selected file: '+file.format,'RECEIVED_EXPORT_CHANGED');
      await receiver.close();receiver=null;
      const final=await cli(['show','--workspace',receivingDirectory,'--operator',operator,'--id',received.id]);
      requireThat(final.revision===received.revision&&final.coverage.length===34&&final.packages.length===2,
        'Receiving command reopen must retain all response and named-handoff records','RECEIVING_REOPEN_CHANGED');
      return {projectId:final.id,revision:final.revision,sources:retained,requirements:final.requirements.length,
        coverage:final.coverage.length,namedPackages:final.packages.length,idempotentReceive:true,
        originalClosed:true,receivingClosed:true};
    });
    journal.status='complete';journal.completedAt=new Date().toISOString();
    journal.context.result={projectId:journal.context.projectId,revision:journal.context.finalRevision,
      originalDirectory,receivingDirectory,portablePath:journal.context.portablePath,
      nativeBrowser:journal.stages['06-native-browser-operator-and-named-download']?.status==='complete',
      stages:Object.values(journal.stages).filter(item=>item.status==='complete').length,
      retainedActions:Object.keys(journal.actions).length,
      outputDirectory,sourceEditionSha256:edition.sha256};
    await save();await checkpoint();
    return {operation:OPERATION,status:'complete',journalPath,...journal.context.result};
  }finally{
    if(browser)await browser.close().catch(()=>{});
    if(receiver)await receiver.close().catch(()=>{});
    if(host)await host.close().catch(()=>{});
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  receiveOpportunityOperation(parse(process.argv.slice(2))).then(result=>process.stdout.write(json(result))).catch(error=>{
    process.stderr.write(JSON.stringify({error:error.code||'RECEIVING_ERROR',message:error.message})+'\n');process.exitCode=1;
  });
}
