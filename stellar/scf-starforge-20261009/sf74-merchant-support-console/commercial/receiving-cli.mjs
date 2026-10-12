// MIT. Complete selected quotation receiving on the original SF74/SF97 stores.
import {parseArgs} from 'node:util';
import {isAbsolute,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {jsonBytes,canonical,sha256,commercialError} from '../commercial-pricing.mjs';
import {
  captureCommercialReceivingSource,inspectCommercialReceivingSource,
  attachCommercialReceivingSource,inspectCommercialCase,
  exportCommercialCasePackage,receiveCommercialCasePackage,
  restoreCommercialPricingWorkspace,
} from './receiving.mjs';

const strings=['pricing-directory','pricing-config','pricing-snapshot','pricing-history','plan-id','scenario-id',
  'backup-request','out','from','source-sha','cases-dir','case','revision','pricing-request','attachment-request',
  'actor','binding-reason','binding-reason-file','quote','quote-sha','archive-sha','export-id','source-dir',
  'generated-at','python','sha256','request-id','archive','report'];
const caseOptions=['cases-dir','case','revision','quote','quote-sha','archive-sha'];
const allowed={
  capture:['pricing-directory','pricing-config','pricing-snapshot','pricing-history','plan-id','scenario-id','backup-request','out'],
  'inspect-source':['from','source-sha'],
  attach:['cases-dir','case','revision','from','source-sha','pricing-request','attachment-request','actor','binding-reason','binding-reason-file'],
  'inspect-case':caseOptions,
  export:[...caseOptions,'out','export-id','source-dir','generated-at','python'],
  receive:['from','sha256','out','cases-dir','source-dir','request-id','actor','quote','quote-sha','archive-sha','python'],
  'restore-pricing':[...caseOptions,'archive','out'],
};
const fail=message=>{throw commercialError('COMMERCIAL_RECEIVING_OPTIONS',message,422);};
const required=(values,name)=>{if(typeof values[name]!=='string'||!values[name])fail('Supply --'+name+'.');return values[name];};
function absolute(value){
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/')
    fail('Use an absolute normalized private path.');
  return value;
}
function sourceSummary(result){
  const {pricingText,pricingSource,pricing,...remaining}=result;
  return {...remaining,selection:{sourceId:pricingSource.id,planId:pricingSource.planId,
    scenarioId:pricingSource.scenarioId,version:pricingSource.version},
    files:result.source.files.map(file=>({...file,path:join(result.directory,file.name)}))};
}
function selectedCase(values,{requireRevision=false}={}){
  return {casesDirectory:absolute(required(values,'cases-dir')),id:required(values,'case'),
    ...(requireRevision?{revision:required(values,'revision')}:values.revision?{revision:values.revision}:{}),
    quoteId:required(values,'quote'),quoteSha256:required(values,'quote-sha'),
    ...(values['archive-sha']?{archiveSha256:values['archive-sha']}:{})};
}
async function sourceService(values,{requiredDirectory=false,environment=process.env}={},run){
  const casesDirectory=absolute(required(values,'cases-dir'));
  const directory=requiredDirectory?absolute(required(values,'source-dir')):
    values['source-dir']?absolute(values['source-dir']):null;
  const store=await openCaseStore(casesDirectory);
  if(!directory)return run({store,sourceDelivery:undefined,casesDirectory});
  const {createCaseSourceDelivery}=await import('../case-source-delivery.mjs');
  const sourceDelivery=await createCaseSourceDelivery({store,directory,environment,
    ...(values.python?{python:values.python}:{})});
  try{return await run({store,sourceDelivery,casesDirectory});}
  finally{await sourceDelivery.close();}
}
function usage(){
  return {command:'merchant-commercial receiving',standalone:'node commercial/receiving-cli.mjs ACTION [options]',
    actions:Object.keys(allowed),
    capture:'--pricing-directory DIR --pricing-config FILE (--pricing-snapshot FILE | --pricing-history FILE) --plan-id UUID [--scenario-id ID] --backup-request UUID --out DIR',
    'inspect-source':'--from DIR [--source-sha SHA256]',
    attach:'--cases-dir DIR --case UUID --revision SHA256 --from DIR --source-sha SHA256 --pricing-request UUID --attachment-request UUID --actor NAME (--binding-reason TEXT | --binding-reason-file FILE)',
    'inspect-case':'--cases-dir DIR --case UUID [--revision SHA256] --quote UUID --quote-sha SHA256 [--archive-sha SHA256]',
    export:'--cases-dir DIR --case UUID --revision SHA256 --quote UUID --quote-sha SHA256 [--archive-sha SHA256] --out DIR --export-id ID [--source-dir DIR] [--generated-at UTC] [--python PATH]',
    receive:'--from DIR --sha256 SHA256 --out DIR --cases-dir DIR --source-dir DIR --request-id ID --actor NAME --quote UUID --quote-sha SHA256 [--archive-sha SHA256] [--python PATH]',
    'restore-pricing':'--cases-dir DIR --case UUID [--revision SHA256] --quote UUID --quote-sha SHA256 [--archive-sha SHA256] --archive FILE --out DIR',
    report:'Any action accepts --report FILE for its first complete JSON result and exact command request. Replays preserve that first report.',
    guide:'sf74-merchant-support-console/commercial/RECEIVING.md'};
}
/** All original stores, source IDs, revisions and requested actions remain explicit. */
export async function commercialReceivingCli(argv=process.argv.slice(2),{environment=process.env,signal}={}){
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,strict:true,
    options:{...Object.fromEntries(strings.map(name=>[name,{type:'string'}])),help:{type:'boolean'}}});
  if(values.help){
    if(positionals.length||Object.keys(values).length!==1)fail('Use --help on its own.');
    return usage();
  }
  if(positionals.length!==1)fail('Select one original quotation receiving action.');
  const action=positionals[0],options=allowed[action];
  if(!options||Object.keys(values).some(name=>name!=='report'&&!options.includes(name)))
    fail('Unknown action or unexpected quotation receiving option.');
  const reportPath=values.report?absolute(values.report):null;
  const reportRequest={action,options:Object.fromEntries(Object.entries(values).filter(([name])=>name!=='report'))};
  let originalReport=null;
  if(reportPath){
    try{originalReport=await readPrivateFile(reportPath,64*1024*1024);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(originalReport){
      const retained=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(originalReport));
      if(retained.schema!=='stellar-forge.merchant-commercial-command-result.v1'||canonical(retained.request)!==canonical(reportRequest))
        fail('The retained command report belongs to another original request. Preserve it and choose the matching report.');
    }
  }
  let result;
  if(action==='capture'){
    const directory=absolute(required(values,'pricing-directory'));
    const snapshot=values['pricing-snapshot'],history=values['pricing-history'];
    if(Boolean(snapshot)===Boolean(history))fail('Select one original saved snapshot or history file.');
    const capture={planId:required(values,'plan-id'),scenarioId:values['scenario-id'],
      backupRequestId:required(values,'backup-request'),directory:absolute(required(values,'out'))};
    // A committed source reopens from its retained originals even after the
    // authoring file paths move. Only a new capture needs the configured model.
    let retained;
    try{retained=await captureCommercialReceivingSource(capture);}
    catch(error){if(error.code!=='COMMERCIAL_PRICING_WORKSPACE_REQUIRED')throw error;}
    if(retained)result=sourceSummary(retained);
    else{
      const {openWorkspace}=await import('../../sf97-merchant-revenue-ops/workspace/model.mjs');
      const {openPlanningWorkspace}=await import('../../sf97-merchant-revenue-ops/planning/workspace.mjs');
      const model=await openWorkspace({config:absolute(required(values,'pricing-config')),directory,
        ...(snapshot?{snapshot:absolute(snapshot)}:{history:absolute(history)})});
      const planning=await openPlanningWorkspace({model,directory});
      result=sourceSummary(await captureCommercialReceivingSource({...capture,model,planning}));
    }
  }else if(action==='inspect-source'){
    result=sourceSummary(await inspectCommercialReceivingSource({directory:absolute(required(values,'from')),
      expectedSourceSha256:values['source-sha']}));
  }else if(action==='attach'){
    if(Boolean(values['binding-reason'])===Boolean(values['binding-reason-file']))
      fail('Supply one explicit matching merchant/source binding reason.');
    const bindingReason=values['binding-reason']??new TextDecoder('utf-8',{fatal:true}).decode(
      await readPrivateFile(absolute(values['binding-reason-file']),4000));
    result=await attachCommercialReceivingSource({
      casesDirectory:absolute(required(values,'cases-dir')),id:required(values,'case'),
      expectedRevision:required(values,'revision'),directory:absolute(required(values,'from')),
      expectedSourceSha256:required(values,'source-sha'),pricingRequestId:required(values,'pricing-request'),
      attachmentRequestId:required(values,'attachment-request'),actor:required(values,'actor'),bindingReason});
  }else if(action==='inspect-case'){
    result=await inspectCommercialCase(selectedCase(values));
  }else if(action==='export'){
    const selection=selectedCase(values,{requireRevision:true});
    result=await sourceService(values,{environment},({store,sourceDelivery})=>exportCommercialCasePackage({
      ...selection,store,sourceDelivery,directory:absolute(required(values,'out')),exportId:required(values,'export-id'),
      generatedAt:values['generated-at'],python:values.python,environment,signal}));
  }else if(action==='receive'){
    result=await sourceService(values,{requiredDirectory:true,environment},({sourceDelivery,casesDirectory})=>receiveCommercialCasePackage({
      directory:absolute(required(values,'from')),receivingDirectory:absolute(required(values,'out')),
      casesDirectory,sourceDelivery,requestId:required(values,'request-id'),actor:required(values,'actor'),
      expectedManifestSha256:required(values,'sha256'),quoteId:required(values,'quote'),quoteSha256:required(values,'quote-sha'),
      archiveSha256:values['archive-sha'],python:values.python,environment,signal}));
  }else if(action==='restore-pricing'){
    result=await restoreCommercialPricingWorkspace({...selectedCase(values),
      archive:absolute(required(values,'archive')),directory:absolute(required(values,'out'))});
  }
  if(reportPath){
    const bytes=originalReport??jsonBytes({schema:'stellar-forge.merchant-commercial-command-result.v1',request:reportRequest,result});
    const pin=originalReport?{bytes:bytes.length,sha256:sha256(bytes)}:await retainCaseArtifact(reportPath,bytes);
    return {...result,report:{path:reportPath,...pin,firstCompletion:true,replayed:originalReport!==null}};
  }
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(jsonBytes(await commercialReceivingCli()));}
  catch(error){process.stderr.write(JSON.stringify({error:error.code??'COMMERCIAL_RECEIVING_FAILED',
    message:error.message,...(error.currentRevision?{currentRevision:error.currentRevision}:{})})+'\n');process.exitCode=1;}
}
