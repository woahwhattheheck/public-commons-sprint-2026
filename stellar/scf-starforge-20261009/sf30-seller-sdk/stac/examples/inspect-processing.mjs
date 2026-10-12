#!/usr/bin/env node
// MIT. Inspect the original configured processing view using an existing browser context.
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const requireValue=(value,message)=>{if(!value)throw new Error(message);};
const safeError=value=>String(value?.message??value??'Unknown error')
  .replace(/https?:\/\/[^\s"'<>]+/g,raw=>{try{const u=new URL(raw);return u.origin+u.pathname;}catch{return '[URL]';}}).slice(0,2000);
const now=()=>new Date().toISOString();
async function atomicJSON(path,value){
  const temporary=path+'.'+randomUUID()+'.partial';
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temporary,path);
}
const parseBody=async response=>{
  requireValue(response.ok(),'A saved processing read returned HTTP '+response.status()+'.');
  return response.json();
};
const savedResponse=(page,name)=>page.waitForResponse(response=>{
  const u=new URL(response.url());return u.pathname==='/api/processing/reads/'+name&&response.request().method()==='GET';
});
const collectLayout=page=>page.evaluate(()=>({
  viewport:innerWidth,
  documentWidth:document.documentElement.scrollWidth,
  overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),
  controls:[...document.querySelectorAll('.processing-panel input,.processing-panel select,.processing-panel textarea,.processing-panel button')]
    .filter(node=>node.getClientRects().length).length,
  panelWidth:document.querySelector('.processing-panel')?.getBoundingClientRect().width??null
}));

export async function inspectProcessingView({
  context,url,outputDirectory,editionId,inventoryId,allowLoopbackOrigin,attachPage
}={}){
  requireValue(context?.newPage,'Pass the existing equipped browser context.');
  requireValue(outputDirectory,'Provide an owned output directory.');
  const address=new URL(url);
  requireValue(address.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(address.hostname),
    'Use the original authenticated loopback operator URL.');
  if(allowLoopbackOrigin)await allowLoopbackOrigin(address.origin);
  outputDirectory=resolve(outputDirectory);
  await mkdir(outputDirectory,{recursive:true,mode:0o700});
  const resultPath=join(outputDirectory,'processing-browser-result.json');
  const result={schema:'scf-stac-processing-browser-inspection/v1',startedAt:now(),status:'RUNNING',steps:[],blockedActions:0,pageErrors:[]};
  await atomicJSON(resultPath,result);
  const page=await context.newPage();
  if(attachPage)attachPage(page);
  const onError=error=>result.pageErrors.push(safeError(error));
  page.on('pageerror',onError);
  const stage=async(name,value)=>{
    result.steps.push({name,completedAt:now(),...value});
    await atomicJSON(resultPath,result);
  };
  await page.route('**/*',async route=>{
    const request=route.request(),u=new URL(request.url());
    if(u.protocol==='data:'||u.protocol==='blob:')return route.continue();
    const allowed=u.origin===address.origin&&(['GET','HEAD'].includes(request.method())||
      request.method()==='POST'&&u.pathname==='/api/session');
    if(!allowed){result.blockedActions++;return route.abort('blockedbyclient');}
    return route.continue();
  });
  try{
    await page.setViewportSize({width:1366,height:1000});
    await page.goto(url,{waitUntil:'domcontentloaded'});
    const tab=page.getByRole('tab',{name:'Processing history',exact:true});
    await tab.waitFor({state:'visible',timeout:30000});await tab.click();
    const panel=page.locator('.processing-panel');await panel.waitFor({state:'visible'});
    await panel.getByText('Saved processing state is ready.',{exact:true}).waitFor({state:'visible',timeout:30000});
    const state=await page.evaluate(async()=>{const response=await fetch('/api/processing/state');if(!response.ok)throw Error('Processing state read failed.');return response.json();});
    const processing=state.processing??state;
    const deployment=processing.deployments.find(value=>(value.dialect??value.deployment?.dialect)==='cirrus-state');
    requireValue(deployment,'The original workspace must retain its configured Cirrus deployment.');
    const history=editionId?processing.editions.find(value=>value.id===editionId):
      processing.editions.filter(value=>value.deploymentKey===deployment.key&&value.selection?.kind==='RUN_HISTORY').at(-1);
    requireValue(history,'Retain the actual native processing run-history edition.');
    const inventory=inventoryId?processing.editions.find(value=>value.id===inventoryId):
      processing.editions.find(value=>value.id===history.selection.inventoryId);
    requireValue(inventory,'Retain the history edition’s original inventory dependency.');
    result.initialRevision=processing.revision;
    await panel.getByLabel('Saved deployment and source edition',{exact:true}).selectOption(deployment.key);
    await panel.getByLabel('Saved inventory',{exact:true}).selectOption(inventory.id);
    const inventoryRead=savedResponse(page,'inventory');
    await panel.getByRole('button',{name:'Open saved workflow inventory',exact:true}).click();
    const nativeInventory=await parseBody(await inventoryRead);
    const workflows=nativeInventory.chains.find(value=>value.kind==='instances')?.records??[];
    requireValue(workflows.length>0,'The retained native inventory has no workflows.');
    await panel.getByText('Original workflow endpoint',{exact:true}).first().waitFor({state:'visible'});
    const since=panel.getByLabel('Native since duration',{exact:true});
    requireValue(await since.inputValue()==='1h','The Cirrus review must preserve its native 1h default.');
    requireValue(await panel.getByLabel('Native state filter',{exact:true}).isEnabled(),'The Cirrus state selector did not activate.');
    const filmDropNames=['events','input payload','output payload','definition'];
    for(const name of filmDropNames)requireValue(await panel.getByLabel(name,{exact:true}).isDisabled(),'FilmDrop-only detail control remained enabled: '+name);
    await stage('native-inventory-and-dialect',{workflows:workflows.length,dialect:'cirrus-state',since:'1h'});

    await panel.getByLabel('Saved processing edition',{exact:true}).selectOption(history.id);
    const expectedContinuations=history.tasks.filter(value=>value.continuationAvailable&&value.latestCaptureSha256).length;
    const continuationCount=await panel.getByRole('button',{name:'Continue from last native payload',exact:true}).count();
    requireValue(continuationCount===expectedContinuations,'The explicit continuation controls differ from the retained task state.');
    if(expectedContinuations){
      const detail=panel.locator('details').filter({has:page.getByRole('button',{name:'Continue from last native payload',exact:true})}).first();
      await detail.locator('summary').first().click();
      requireValue(await panel.getByRole('button',{name:'Prepare continuation for an external capture',exact:true}).first().isVisible(),
        'The original external continuation handover control is missing.');
    }
    await stage('retained-coverage-and-continuation',{tasks:history.tasks.length,explicitContinuations:continuationCount});

    const runsRead=savedResponse(page,'runs');
    await panel.getByRole('button',{name:'Read saved runs',exact:true}).click();
    const runData=await parseBody(await runsRead),runs=runData.runs??[];
    requireValue(runs.length>0,'The actual history has no retained native runs.');
    const chosen=runs[0];
    await panel.getByLabel('Native run',{exact:true}).selectOption(chosen.key);
    const detailRead=savedResponse(page,'run');
    await panel.getByRole('button',{name:'Open native run details',exact:true}).click();
    const nativeRun=await parseBody(await detailRead);
    requireValue(nativeRun.latest?.payload_id===chosen.latest.payload_id,'The detail read changed the native payload identity.');
    requireValue((await panel.innerText()).includes(nativeRun.latest.payload_id),'The actual payload identity is absent from the view.');
    await stage('native-run-details',{retainedRuns:runs.length,nativeState:nativeRun.latest.state,
      executions:Array.isArray(nativeRun.latest.executions)?nativeRun.latest.executions.length:0});

    await panel.locator('summary').filter({hasText:'Native workflow counts and state transitions'}).click();
    const statisticsRead=savedResponse(page,'statistics');
    await panel.getByRole('button',{name:'Read saved workflow counts and metrics',exact:true}).click();
    const nativeStatistics=await parseBody(await statisticsRead);
    const summaryRecords=nativeStatistics.summaries??[];
    const capped=summaryRecords.flatMap(value=>Object.values(value.document?.counts??{})).filter(value=>typeof value==='string'&&/^\d+\+$/.test(value));
    if(capped.length)requireValue((await panel.innerText()).includes(capped[0]),'The original capped count was not rendered literally.');
    const statistics=nativeStatistics.statistics??[];
    requireValue(statistics.length>0,'The actual original statistics response is missing.');
    const selected=statistics.at(-1),series=selected.document?.state_transitions??{};
    const seriesName=Object.keys(series).find(name=>Array.isArray(series[name])&&series[name].some(period=>(period.states??[]).some(item=>item.count!==item.unique_count)))??Object.keys(series)[0];
    requireValue(seriesName,'The retained native state-transition series is empty.');
    await panel.getByLabel('Native interval series',{exact:true}).selectOption(seriesName);
    const periods=series[seriesName];
    let periodIndex=periods.findIndex(period=>(period.states??[]).some(item=>item.count!==item.unique_count));if(periodIndex<0)periodIndex=0;
    await panel.getByLabel('Native period',{exact:true}).selectOption(String(periodIndex));
    const period=periods[periodIndex],different=(period.states??[]).find(item=>item.count!==item.unique_count);
    if(different){
      const transitionTable=panel.locator('table').filter({has:page.getByRole('columnheader',{name:'unique_count',exact:true})});
      const row=transitionTable.getByRole('row').filter({has:page.getByRole('cell',{name:different.state,exact:true})});
      const values=await row.locator('td').allTextContents();
      requireValue(values[1]===String(different.count)&&values[2]===String(different.unique_count),'Native transition count and unique_count were conflated.');
    }
    await stage('actual-statistics',{workflowSummaries:summaryRecords.length,cappedValues:capped.length,
      statisticsResponses:statistics.length,series:seriesName,periods:periods.length,
      distinctCountFields:different?{count:different.count,unique_count:different.unique_count}:null});

    const note=panel.getByLabel('Review note',{exact:true});
    await note.fill('Operator draft retained across state refresh.');
    await note.focus();await note.evaluate(node=>node.setSelectionRange(9,9));
    const stateRead=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state'&&response.request().method()==='GET');
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(node=>node.textContent==='Refresh saved state')?.click());
    await stateRead;
    await page.waitForFunction(()=>{
      const node=[...document.querySelectorAll('.processing-panel label')].find(label=>label.querySelector('span')?.textContent==='Review note')?.querySelector('textarea');
      return node===document.activeElement&&node.selectionStart===9&&node.selectionEnd===9;
    },null,{timeout:10000});
    requireValue(await note.inputValue()==='Operator draft retained across state refresh.','The unsaved operator draft changed during refresh.');
    await stage('draft-focus-and-caret',{preserved:true,caret:9});

    await panel.evaluate(node=>node.scrollIntoView({block:'start'}));
    const desktop=await collectLayout(page);
    await page.screenshot({path:join(outputDirectory,'processing-desktop.png'),fullPage:false});
    await page.setViewportSize({width:390,height:844});
    await panel.evaluate(node=>node.scrollIntoView({block:'start'}));
    const mobile=await collectLayout(page);
    await page.screenshot({path:join(outputDirectory,'processing-mobile.png'),fullPage:false});
    requireValue(desktop.overflow<=1&&mobile.overflow<=1,'The actual processing view overflows the document viewport.');
    await stage('industrial-responsive-layout',{desktop,mobile});
    const finalState=await page.evaluate(async()=>{const response=await fetch('/api/processing/state');return response.json();});
    const finalProcessing=finalState.processing??finalState;
    result.finalRevision=finalProcessing.revision;
    requireValue(result.initialRevision===result.finalRevision,'The browser inspection unexpectedly changed the processing workspace.');
    requireValue(result.blockedActions===0,'The view attempted an action outside its saved local reads.');
    requireValue(result.pageErrors.length===0,'The actual processing view raised a browser error.');
    result.status='COMPLETE';result.completedAt=now();
    await atomicJSON(resultPath,result);
    const raw=JSON.stringify(result,null,2)+'\n';
    return {status:result.status,steps:result.steps.length,pageErrors:0,blockedActions:0,
      desktop,mobile,resultPath,resultSha256:createHash('sha256').update(raw).digest('hex')};
  }catch(error){
    result.status='FAILED';result.error=safeError(error);result.completedAt=now();
    await atomicJSON(resultPath,result);
    throw error;
  }finally{page.off('pageerror',onError);await page.close();}
}
