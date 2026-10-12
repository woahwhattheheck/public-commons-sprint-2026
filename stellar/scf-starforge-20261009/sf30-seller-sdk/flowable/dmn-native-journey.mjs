// MIT. Original Flowable DMN business cohorts, versioned decisions, browser operation and complete audit receiving.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{code:'FLOWABLE_DMN_JOURNEY_FAILED'});};
const ref=record=>({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256});
const rows=variables=>variables.flatMap(item=>Array.isArray(item)?item:[item]);
const canonical=value=>JSON.stringify(value);
const nativeKinds=['deployments','definitions','historicExecutions'];

export async function runFlowableDmnNativeJourney({
  configuration,directory,connectionId,call,source,operation,retainReview,step,freeze,requestId,client,browserUrl,signal
}) {
  const catalogBytes=await readFile(new URL('./fixtures/decisions/decision-catalog.json',import.meta.url));
  const catalog=JSON.parse(catalogBytes);
  need(catalog.schema==='stellar-forge.flowable-dmn-native-fixtures.v1' && catalog.engineVersion==='8.0.0' &&
    catalog.nativeSourceRevision==='0779d68e5a3385b74d8acb8bc37901ff54513249' && catalog.families.length===3,
    'Use the complete original Flowable 8 decision cohort and its native engine source.');
  const familyFiles=new Map();
  for(const family of catalog.families) {
    need(family.files.length===2 && family.cases.length>0,'Each original decision family has two editions and native business cases.');
    for(const member of family.files) {
      need(member.filename===member.filename.split('/').pop() && !member.filename.includes('..'),
        'Read the original named DMN cohort resource.');
      const bytes=await readFile(new URL('./fixtures/decisions/'+member.filename,import.meta.url));
      need(bytes.length===member.bytes && sha(bytes)===member.sha256,'The complete original decision resource changed: '+member.filename);
      familyFiles.set(family.id+':'+member.edition,{...member,bytesValue:bytes});
    }
  }
  async function capture(label) {
    const record=await call('captureDecisionPortfolio',await freeze('dmn:'+label+':capture',{
      requestId:requestId('dmn:'+label+':capture'),connectionId,label:configuration.operation+' '+label}));
    need(record.value.state==='CAPTURED','Capture all original native decision definitions, deployments and execution audits: '+
      JSON.stringify(record.value.failure??record.value.summary));
    return ref(record);
  }
  async function collection(portfolio,collection) {
    const items=[];let offset=0;
    for(;;) {
      const page=await call('readDecisionPortfolio',{id:portfolio.id,revision:portfolio.revision,collection,offset,limit:3});
      need(page.complete && page.offset===offset,'Read the complete saved native decision '+collection+' collection.');
      items.push(...page.items);
      if(page.nextOffset===null){need(items.length===page.total,'Receive every captured native decision record.');break;}
      need(page.nextOffset>offset,'Native decision portfolio pagination advances.');offset=page.nextOffset;
    }
    return items;
  }
  async function allRecords(kind) {
    const items=[];let offset=0;
    for(;;) {
      const page=await call('listRecords',{kind,offset,limit:37});items.push(...page.items);
      if(page.nextOffset===null)return items;offset=page.nextOffset;
    }
  }
  function selection(family,item) {
    return {action:'evaluate',mode:item.mode,singleResult:item.singleResult,
      bodyText:JSON.stringify({decisionKey:family.key,inputVariables:item.inputVariables,disableHistory:false})};
  }
  async function outcome(record,family,item,edition) {
    const current=await call('getRecord',{kind:'decisionEvaluation',id:record.id});
    need(['CONFIRMED','ACCEPTED','OBSERVED'].includes(current.value.state) && current.value.response,
      'The native decision evaluation must retain its actual accepted result: '+current.value.state);
    const response=await source(current.value.response),originalSelection=await source(current.value.selection);
    need(response.status===201 && Array.isArray(response.json?.resultVariables),
      'Read the actual original Flowable 201 decision result variables.');
    const result=rows(response.json.resultVariables),expected=item.expectedByEdition.find(value=>value.edition===edition);
    const routes=result.filter(value=>value.name==='reviewRoute');
    need(expected && routes.length===1 && routes[0].value===expected.reviewRoute,
      family.id+' '+item.id+' edition '+edition+' must produce its authored native review route.');
    need(originalSelection.bodyText===selection(family,item).bodyText,
      'The native evaluation keeps the complete original typed input JSON.');
    const before=await source(current.value.before);
    need(before.definitions.some(value=>value.key===family.key && Number(value.version)===edition),
      'The reviewed native decision state includes the actual selected edition.');
    await retainReview(current);
    return {record:ref(current),family:family.id,caseId:item.id,edition,
      selection:originalSelection,response:{status:response.status,bytes:response.bodyBytes,sha256:response.bodySha256},
      resultVariables:response.json.resultVariables,reviewRoute:routes[0].value};
  }
  async function releaseEdition(edition) {
    const releases=[];
    for(const family of catalog.families) {
      const member=familyFiles.get(family.id+':'+edition);
      const record=await operation('dmn '+family.id+' deploy v'+edition,'decisionRelease',{action:'deploy',
        resource:{filename:member.filename,contentType:'application/xml',contentBase64:member.bytesValue.toString('base64')}},connectionId);
      releases.push({family:family.id,edition,record:ref(record),source:{filename:member.filename,bytes:member.bytes,sha256:member.sha256}});
    }
    const portfolio=await capture('native decision edition '+edition),definitions=await collection(portfolio,'definitions');
    const selected=[];
    for(const family of catalog.families) {
      const familyDefinitions=definitions.filter(item=>item.key===family.key);
      need(familyDefinitions.length===edition && Math.max(...familyDefinitions.map(item=>Number(item.version)))===edition,
        'Native deployment must retain each actual decision version for '+family.id+'.');
      for(const definition of familyDefinitions) {
        const original=await call('readDecisionDefinition',{portfolioId:portfolio.id,revision:portfolio.revision,definitionId:definition.id});
        const member=familyFiles.get(family.id+':'+Number(definition.version));
        need(original.resources.some(resource=>resource.kind==='dmn-definition-resource' &&
          resource.sha256===member.sha256 && resource.bytes===member.bytes),
          'The native decision definition retains the exact deployed edition resource.');
        for(const resource of original.resources)if(resource.originalResource) {
          await client.downloadSource(resource.originalResource,join(directory,'downloads','dmn-'+resource.sha256+'.source'),{signal});
        }
        selected.push({id:definition.id,key:definition.key,version:definition.version,deploymentId:definition.deploymentId});
      }
    }
    return {releases,portfolio,definitions:selected};
  }
  async function evaluateEdition(edition) {
    const results=[];
    for(const family of catalog.families)for(const item of family.cases) {
      const record=await operation('dmn '+family.id+' '+item.id+' v'+edition,'decisionEvaluation',
        selection(family,item),connectionId);
      results.push(await outcome(record,family,item,edition));
    }
    return {edition,results,portfolio:await capture('native decision evaluations v'+edition)};
  }
  const first=await step('three-original-dmn-release-families',()=>releaseEdition(1));
  const firstResults=await step('native-dmn-first-edition-business-cases',()=>evaluateEdition(1));
  const second=await step('three-second-native-dmn-releases',()=>releaseEdition(2));
  const secondResults=await step('native-dmn-second-edition-business-cases',()=>evaluateEdition(2));
  const changed=secondResults.results.filter(value=>{
    const prior=firstResults.results.find(item=>item.family===value.family && item.caseId===value.caseId);
    return prior && prior.reviewRoute!==value.reviewRoute;
  });
  need(changed.length===3,'All three authored rule changes must alter their actual native business-case outcomes.');
  const numeric=secondResults.results.find(item=>item.caseId==='exact-decimal-and-large-integer');
  need(numeric?.selection.bodyText.includes('"value":"10000.1250"') &&
    numeric.selection.bodyText.includes('"value":"922337203685477580612345"'),
    'The native decision operation preserves exact decimal and large integer request values.');
  const browserResult=await step('industrial-native-decision-browser-operation-and-audit',async()=>{
    need(configuration.playwrightModule && configuration.chromiumExecutable,
      'Open the original installed Chromium runtime for the native decision operator.');
    const family=catalog.families.find(item=>item.id==='grant-eligibility'),item=family.cases[0];
    const label=configuration.operation+' decision browser evaluation';
    const existing=(await allRecords('decisionEvaluation')).find(item=>item.label===label);
    if(existing) {
      const record=await call('getRecord',{kind:'decisionEvaluation',id:existing.id});
      if(record.value.dispatchedAt && ['UNKNOWN','DISPATCHED','READBACK'].includes(record.value.state)) {
        await call('reconcileOperation',await freeze('dmn:browser:reconcile',{
          requestId:requestId('dmn:browser:reconcile'),kind:'decisionEvaluation',id:record.id}));
      }
    }
    const imported=await import(pathToFileURL(resolve(configuration.playwrightModule)).href);
    const playwright=imported.chromium?imported:imported.default;
    const browser=await playwright.chromium.launch({headless:true,executablePath:resolve(configuration.chromiumExecutable),
      args:['--no-sandbox','--disable-dev-shm-usage']});
    const screenshots=[],errors=[];let result;
    try {
      const page=await browser.newPage({viewport:{width:1440,height:1000}});
      page.on('pageerror',error=>errors.push(String(error)));
      await page.goto(browserUrl,{waitUntil:'networkidle'});
      await page.locator('#busy').waitFor({state:'hidden'});
      await page.locator('#engine-select').selectOption(connectionId);
      await page.locator('#busy').waitFor({state:'hidden'});
      await page.getByRole('button',{name:'Decisions',exact:true}).click();
      await page.waitForSelector('#decisions-table table');
      const definitionsScreenshot=join(directory,'screenshots','native-decision-definitions.png');
      await page.screenshot({path:definitionsScreenshot,fullPage:true});
      const definitionBytes=await readFile(definitionsScreenshot);
      screenshots.push({path:definitionsScreenshot,bytes:definitionBytes.length,sha256:sha(definitionBytes)});
      if(existing) {
        await page.locator('#decisionEvaluation-records tbody tr').filter({hasText:label})
          .getByRole('button',{name:'Review',exact:true}).first().click();
        await page.locator('#busy').waitFor({state:'hidden'});
      } else {
        const form=page.locator('#decisionEvaluation-form');
        await form.locator('[name="label"]').fill(label);
        await form.locator('[name="mode"]').selectOption(item.mode);
        await form.locator('[name="singleResult"]').setChecked(item.singleResult);
        await form.locator('[name="bodyText"]').fill(selection(family,item).bodyText);
        await form.locator('button[type="submit"]').click();
        await page.locator('#busy').waitFor({state:'hidden'});
      }
      const execute=page.locator('#detail-content').getByRole('button',{name:'Evaluate decisions',exact:true});
      if(await execute.count()) {
        await execute.click();await page.locator('#busy').waitFor({state:'hidden'});
      }
      need((await page.locator('#notice').getAttribute('data-level'))!=='error',
        'The original browser must complete the saved native decision evaluation.');
      const record=(await allRecords('decisionEvaluation')).find(item=>item.label===label);
      need(record,'The browser evaluation is retained in the same original workspace.');
      result=await outcome(record,family,item,2);
      const evaluationScreenshot=join(directory,'screenshots','native-decision-evaluation.png');
      await page.screenshot({path:evaluationScreenshot,fullPage:true});
      const evaluationBytes=await readFile(evaluationScreenshot);
      screenshots.push({path:evaluationScreenshot,bytes:evaluationBytes.length,sha256:sha(evaluationBytes)});
      await page.locator('#capture-decisions').click();await page.locator('#busy').waitFor({state:'hidden'});
      await page.locator('#historic-decisions-table').getByRole('button',{name:'Execution and audit',exact:true}).first().click();
      await page.locator('#busy').waitFor({state:'hidden'});
      need((await page.locator('#notice').getAttribute('data-level'))!=='error',
        'Open the original selected native decision execution and its complete audit data.');
      const auditScreenshot=join(directory,'screenshots','native-decision-audit.png');
      await page.screenshot({path:auditScreenshot,fullPage:true});
      const auditBytes=await readFile(auditScreenshot);
      screenshots.push({path:auditScreenshot,bytes:auditBytes.length,sha256:sha(auditBytes)});
      need(errors.length===0,'The actual decision browser produced a script error: '+errors.join('\n'));
      return {browserVersion:browser.version(),evaluation:result,screenshots};
    } finally {await browser.close();}
  });
  const complete=await step('complete-original-native-dmn-execution-audits',async()=>{
    const portfolio=await capture('complete native decision history after browser'),collections={};
    for(const kind of nativeKinds)collections[kind]=await collection(portfolio,kind);
    const familyKeys=new Set(catalog.families.map(item=>item.key));
    const definitions=collections.definitions.filter(item=>familyKeys.has(item.key));
    need(definitions.length===6 && collections.historicExecutions.length>=9,
      'The complete native capture contains both editions and all nine original business evaluations.');
    const audits=[];
    for(const execution of collections.historicExecutions) {
      const selected=await call('readDecisionExecution',{portfolioId:portfolio.id,revision:portfolio.revision,executionId:execution.id});
      const resources=selected.resources.filter(item=>item.kind==='dmn-execution-audit');
      need(resources.length>0,'Retain complete native audit data for execution '+execution.id+'.');
      for(const resource of resources) {
        need(resource.executionId===execution.id && resource.originalResource,
          'Each audit resource remains attached to its exact native execution.');
        const file=await client.downloadSource(resource.originalResource,
          join(directory,'downloads','dmn-audit-'+resource.sha256+'.json'),{signal});
        need(file.sha256===resource.sha256 && file.bytes===resource.bytes,'Receive the exact original native audit bytes.');
        audits.push({executionId:execution.id,...file});
      }
    }
    return {portfolio,definitions,audits,collections:Object.fromEntries(nativeKinds.map(kind=>[kind,collections[kind].length]))};
  });
  return {schema:'stellar-forge.flowable-dmn-native-journey.v1',state:'PASSED',
    families:catalog.families.length,releaseVersions:first.releases.length+second.releases.length,
    nativeBusinessEvaluations:firstResults.results.length+secondResults.results.length+1,
    changedBusinessOutcomes:changed.map(item=>({family:item.family,caseId:item.caseId,reviewRoute:item.reviewRoute})),
    exactTypedInput:{decimal:'10000.1250',integer:'922337203685477580612345'},
    catalogSha256:sha(catalogBytes),first,firstResults,second,secondResults,browser:browserResult,complete};
}
