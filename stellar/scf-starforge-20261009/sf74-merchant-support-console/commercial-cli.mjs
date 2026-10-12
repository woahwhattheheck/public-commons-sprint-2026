// MIT. Original merchant case quotation and SF97 selected-source command.
import {parseArgs} from 'node:util';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPrivateFile} from '../sf93-seller-support-bundle/incident-store.mjs';
import {writeBytes,privateDirectory} from '../sf88-operator-buyer-cli/node/store.mjs';
import {openCaseStore} from './case-store.mjs';
import {commissioningCli} from './commissioning-cli.mjs';
import {commercialReceivingCli} from './commercial/receiving-cli.mjs';
import {openCaseCommercial,commercialWorkspaceId} from './case-commercial.mjs';
import {captureCommercialPricingSource,jsonBytes,sha256} from './commercial-pricing.mjs';
import {emptyCommercialDraft} from './commercial-quote.mjs';
import {MAX_MATERIAL_BYTES} from './commissioning.mjs';

const stringNames=['cases-dir','case','revision','request-id','actor','draft','review-sha','parent','source',
  'quote','quote-sha','status','observed-at','reference','note','before','after','kind','out','export-id',
  'pricing-config','pricing-directory','pricing-snapshot','pricing-history','plan-id','scenario-id',
  'source-dir','generated-at','python','from','sha256'];
const required=(values,name)=>{if(typeof values[name]!=='string'||!values[name])throw new Error('Supply --'+name);return values[name];};
function absolute(value){if(!isAbsolute(value)||resolve(value)!==value)throw new Error('Use an absolute normalized private path.');return value;}
async function originalJson(path){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readPrivateFile(absolute(path),MAX_MATERIAL_BYTES)));}
async function outputFile(path,bytes) {
  path=absolute(path);await privateDirectory(dirname(path));
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;const existing=await readPrivateFile(path,Math.max(bytes.length,1));if(!Buffer.from(existing).equals(bytes))throw new Error('The selected output already contains different original bytes.');}
  return {path,bytes:bytes.length,sha256:sha256(bytes)};
}
export async function commercialCli(argv=process.argv.slice(2),{environment=process.env,signal}={}) {
  if(argv[0]==='receiving')return commercialReceivingCli(argv.slice(1),{environment,signal});
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,strict:true,
    options:{...Object.fromEntries(stringNames.map(n=>[n,{type:'string'}])),help:{type:'boolean'}}});
  if(values.help){if(positionals.length||Object.keys(values).length!==1)throw new Error('Use --help on its own.');return {
    command:'merchant-commercial',usage:'starforge merchant-commercial ACTION [options]',
    actions:['template','source','read','preview','save-draft','publish','receive-pricing','receive','compare','quote','handoff','export','inspect-package','receive-package','receiving'],
    source:'--pricing-config FILE --pricing-directory DIR (--pricing-snapshot FILE | --pricing-history FILE) --plan-id UUID [--scenario-id ID] --out FILE',
    case:'--cases-dir DIR --case UUID',
    mutation:'--revision SHA256 --request-id UUID --actor NAME',
    preview:'--draft FILE [--out FILE]',publish:'--draft FILE --review-sha SHA256 [--parent UUID]',
    receive:'--quote UUID --quote-sha SHA256 --status ACCEPTED|REVISION_REQUESTED|DECLINED --observed-at UTC --reference TEXT [--note TEXT]',
    quote:'--quote UUID --quote-sha SHA256 --out FILE [--kind QUOTE|QUOTE_JSON]',
    export:'--revision SHA256 --out DIR [--export-id ID] [--source-dir DIR] [--generated-at UTC] [--python PATH] uses the original complete case/source exporter',
    'inspect-package':'--from DIR [--sha256 SHA256] [--python PATH]',
    'receive-package':'--from DIR --out DIR --cases-dir DIR --source-dir DIR --request-id UUID --actor NAME [--sha256 SHA256] [--python PATH]',
    receiving:'merchant-commercial receiving --help uses the complete original selected plan, workspace backup, case export and independent restore workflow',
    guide:'sf74-merchant-support-console/COMMERCIAL.md'};}
  if(positionals.length!==1)throw new Error('Select one merchant-commercial action.');
  const action=positionals[0],common=['cases-dir','case'];
  const mutation=[...common,'revision','request-id','actor'];
  const allowed={
    template:['out'],source:['pricing-config','pricing-directory','pricing-snapshot','pricing-history','plan-id','scenario-id','out'],
    read:[...common,'revision'],preview:[...common,'revision','draft','out'],
    'save-draft':[...mutation,'draft'],publish:[...mutation,'draft','review-sha','parent'],
    'receive-pricing':[...mutation,'source'],receive:[...mutation,'quote','quote-sha','status','observed-at','reference','note'],
    compare:[...common,'revision','before','after'],quote:[...common,'revision','quote','quote-sha','kind','out'],
    handoff:[...common,'revision','quote','quote-sha','out'],export:[...common,'revision','out','export-id','source-dir','generated-at','python'],
    'inspect-package':['from','sha256','python'],
    'receive-package':['from','sha256','out','cases-dir','source-dir','request-id','actor','python'],
  }[action];
  if(!allowed||Object.keys(values).some(k=>!allowed.includes(k)))throw new Error('Unknown action or unexpected quotation option.');
  if(action==='template'){const value=emptyCommercialDraft();return values.out?{draft:value,file:await outputFile(values.out,jsonBytes(value))}:value;}
  if(action==='source') {
    const directory=absolute(required(values,'pricing-directory'));await privateDirectory(directory,{create:false});
    const snapshot=values['pricing-snapshot'],history=values['pricing-history'];
    if(Boolean(snapshot)===Boolean(history))throw new Error('Select one original configured snapshot or history file.');
    const {openWorkspace}=await import('../sf97-merchant-revenue-ops/workspace/model.mjs');
    const {openPlanningWorkspace}=await import('../sf97-merchant-revenue-ops/planning/workspace.mjs');
    const model=await openWorkspace({config:absolute(required(values,'pricing-config')),directory,
      ...(snapshot?{snapshot:absolute(snapshot)}:{history:absolute(history)})});
    const planning=await openPlanningWorkspace({model,directory});
    const value=await captureCommercialPricingSource({model,planning,planId:required(values,'plan-id'),scenarioId:values['scenario-id']});
    const file=await outputFile(required(values,'out'),jsonBytes(value));
    return {state:'COMPLETE',sourceId:value.id,planId:value.planId,scenarioId:value.scenarioId,version:value.version,file};
  }
  if(['export','inspect-package','receive-package'].includes(action)) {
    const forwarded=[action];
    for(const key of allowed)if(values[key]!==undefined)forwarded.push('--'+key,values[key]);
    return commissioningCli(forwarded);
  }
  const directory=absolute(required(values,'cases-dir')),id=required(values,'case');
  const model=openCaseCommercial({store:await openCaseStore(directory),workspaceId:commercialWorkspaceId(directory)});
  if(action==='read')return model.read({id,...(values.revision?{revision:values.revision}:{})});
  const base={id,expectedRevision:required(values,'revision')};
  if(action==='preview') {
    const result=await model.preview({...base,draft:await originalJson(required(values,'draft'))});
    return values.out?{...result,file:await outputFile(values.out,jsonBytes(result))}:result;
  }
  if(action==='compare')return model.compare({...base,beforeId:required(values,'before'),afterId:required(values,'after')});
  if(action==='quote'||action==='handoff') {
    const result=await model.download({...base,quoteId:required(values,'quote'),quoteSha256:required(values,'quote-sha'),
      kind:action==='handoff'?'HANDOFF':values.kind??'QUOTE'});
    const file=await outputFile(required(values,'out'),result.body);
    return {...result,body:undefined,file};
  }
  const operation={...base,requestId:required(values,'request-id'),actor:required(values,'actor')};
  if(action==='save-draft')return model.saveDraft({...operation,draft:await originalJson(required(values,'draft'))});
  if(action==='publish') {
    const draft=await originalJson(required(values,'draft'));
    return model.publish({...operation,draft,reviewSha256:required(values,'review-sha'),parentId:values.parent??draft.parentId??null});
  }
  if(action==='receive-pricing') {
    const sourceText=new TextDecoder('utf-8',{fatal:true}).decode(await readPrivateFile(absolute(required(values,'source')),MAX_MATERIAL_BYTES));
    return model.receivePricing({...operation,sourceText,sourceSha256:sha256(sourceText)});
  }
  if(action==='receive')return model.receive({...operation,quoteId:required(values,'quote'),quoteSha256:required(values,'quote-sha'),
    status:required(values,'status'),observedAt:required(values,'observed-at'),source:required(values,'reference'),note:values.note??''});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{process.stdout.write(jsonBytes(await commercialCli()));}
  catch(error){process.stderr.write(JSON.stringify({error:error.code??'COMMERCIAL_OPERATION_FAILED',detail:error.message,
    ...(error.currentRevision?{currentRevision:error.currentRevision}:{})})+'\n');process.exitCode=1;}
}
