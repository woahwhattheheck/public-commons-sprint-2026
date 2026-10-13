// MIT. Private quote economics on the original merchant-commercial command.
import {parseArgs} from 'node:util';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {openCaseCommercial,commercialWorkspaceId} from '../case-commercial.mjs';
import {MAX_MATERIAL_BYTES} from '../commissioning.mjs';
import {jsonBytes,sha256} from '../commercial-pricing.mjs';
import {emptyCommercialEconomicsInput,normalizeCommercialEconomicsInput} from './economics.mjs';
import {inspectEconomicsCase,exportEconomicsCase,inspectEconomicsPackage,receiveEconomicsCase,exportEconomicsHandoff} from './economics-receiving.mjs';

import {prepareEffortEconomics,reopenEffortEconomics} from './effort-economics.mjs';

const names=['cases-dir','case','revision','quote','quote-sha','assessment','assessment-sha',
  'input','input-sha','as-of','out','request-id','actor','review-sha','kind','from','sha256',
  'source-dir','export-id','generated-at','python','acceptance','acceptance-sha',
  'archive','archive-sha','installation','installation-revision','installation-sha','report-sha','hours-basis','cost-basis'];
const common=['cases-dir','case','revision'];
const selection=['quote','quote-sha','assessment','assessment-sha'];
const allowed={
  'effort-preview':[...common,...selection,'archive','archive-sha','installation','installation-revision','installation-sha','report-sha','hours-basis','cost-basis','out','python'],
  'effort-reopen':['cases-dir','from','sha256','python'],
  seed:[...common,'quote','quote-sha','as-of','out'],
  list:common,preview:[...common,'input','input-sha','out'],
  save:[...common,'input','input-sha','request-id','actor','review-sha'],
  file:[...common,'assessment','assessment-sha','kind','out'],
  inspect:[...common,...selection],
  export:[...common,...selection,'out','export-id','source-dir','generated-at','python'],
  'inspect-package':['from','sha256',...selection,'python'],
  receive:['from','sha256','out','cases-dir','source-dir','request-id','actor',...selection,'python'],
  handoff:[...common,...selection,'out','acceptance','acceptance-sha'],
};
const required=(v,k)=>{if(typeof v[k]!=='string'||!v[k])throw new Error('Supply --'+k);return v[k];};
function absolute(path){
  if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||path==='/')throw new Error('Use an absolute normalized private path.');
  return path;
}
function selected(v){return {quoteId:required(v,'quote'),quoteSha256:required(v,'quote-sha'),
  assessmentId:required(v,'assessment'),assessmentSha256:required(v,'assessment-sha')};}
function caseSelection(v){return {casesDirectory:absolute(required(v,'cases-dir')),id:required(v,'case'),revision:required(v,'revision')};}
async function save(path,bytes){path=absolute(path);return {path,...await retainCaseArtifact(path,bytes)};}
async function input(v){
  const bytes=await readPrivateFile(absolute(required(v,'input')),MAX_MATERIAL_BYTES);
  if(sha256(bytes)!==required(v,'input-sha'))throw new Error('The complete private input differs from --input-sha.');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function withSources(v,environment,callback){
  const store=await openCaseStore(absolute(required(v,'cases-dir')));
  let delivery,primary;
  try{
    if(v['source-dir']){
      const {createCaseSourceDelivery}=await import('../case-source-delivery.mjs');
      delivery=await createCaseSourceDelivery({store,directory:absolute(v['source-dir']),
        environment,...(v.python?{python:v.python}:{})});
    }
    return await callback({store,sourceDelivery:delivery});
  }catch(error){primary=error;throw error;}
  finally{try{await delivery?.close();}catch(error){if(primary){primary.closeError=error;throw primary;}throw error;}}
}
export async function commercialEconomicsCli(argv=process.argv.slice(2),{environment=process.env,signal}={}){
  const {values:v,positionals}=parseArgs({args:argv,allowPositionals:true,strict:true,
    options:{...Object.fromEntries(names.map(name=>[name,{type:'string'}])),help:{type:'boolean'}}});
  if(v.help){
    if(positionals.length||Object.keys(v).length!==1)throw new Error('Use --help on its own.');
    return {command:'merchant-commercial economics',actions:Object.keys(allowed),
      case:'--cases-dir DIR --case UUID --revision SHA256',
      selection:'--quote UUID --quote-sha SEALED_QUOTE_SHA256 --assessment UUID --assessment-sha SEALED_ASSESSMENT_SHA256',
      seed:'Case + --quote UUID --quote-sha SHA256 --as-of YYYY-MM-DD --out INPUT.json; all cost/effort assumptions start unknown.',
      preview:'Case + --input INPUT.json --input-sha FILE_SHA256 [--out REVIEW.json]',
      save:'Same case and original input + --request-id UUID --actor NAME --review-sha REVIEW_SHA256. Reuse all original fields after an interrupted reply.',
      file:'Case + --assessment UUID --assessment-sha SHA256 --kind JSON|REPORT --out FILE',
      inspect:'Case + selection; reproduce the exact quote and private assessment.',
      export:'Case + selection + --out DIR --export-id ID [--source-dir DIR] [--generated-at UTC] [--python PATH]',
      'inspect-package':'--from DIR --sha256 CASE_SOURCE_MANIFEST_SHA256 + selection [--python PATH]',
      receive:'--from DIR --sha256 CASE_SOURCE_MANIFEST_SHA256 --out DIR --cases-dir DIR --source-dir DIR --request-id ID --actor NAME + selection [--python PATH]',
      handoff:'Case + selection + --out PRIVATE_DIR [--acceptance UUID --acceptance-sha RESPONSE_MATERIAL_SHA256]',
      'effort-preview':'Case + quote/assessment selection + --archive COMPLETE_INSTALLATION.zip --archive-sha SHA --installation ID --installation-revision N --installation-sha SHA --report-sha SHA --hours-basis RECORDED|PROJECTED --cost-basis UNKNOWN|REUSE_SELECTED_PLAN --out PRIVATE_DIR [--python PATH]; full native verification, original economics preview, no save.',
      'effort-reopen':'--cases-dir DIR --from PRIVATE_HANDOFF --sha256 ORIGINAL_HANDOFF_MANIFEST_SHA [--python PATH]; complete native source and original economics replay.',
      privacy:'Assessment files and whole-case handoffs contain private costs/assumptions. Customer quote JSON/Markdown are unchanged. No Forecast row, payment or customer acceptance is generated.',
      guide:'sf74-merchant-support-console/commercial/ECONOMICS_RECEIVING.md'};
  }
  if(positionals.length!==1)throw new Error('Select one private economics action.');
  const action=positionals[0];
  if(!allowed[action]||Object.keys(v).some(key=>!allowed[action].includes(key)))throw new Error('Unexpected private economics action or option.');
  const native={python:v.python,environment,signal};
  if(action==='effort-reopen')return reopenEffortEconomics({...native,casesDirectory:absolute(required(v,'cases-dir')),
    directory:absolute(required(v,'from')),manifestSha256:required(v,'sha256')});
  if(action==='effort-preview'){
    if(!/^[1-9]\d*$/.test(required(v,'installation-revision')))throw new Error('Use a positive original Installation revision.');
    return prepareEffortEconomics({...native,...caseSelection(v),...selected(v),directory:absolute(required(v,'out')),
      archive:absolute(required(v,'archive')),archiveSha256:required(v,'archive-sha'),installationId:required(v,'installation'),
      installationRevision:Number(v['installation-revision']),installationSha256:required(v,'installation-sha'),
      reportSha256:required(v,'report-sha'),hoursBasis:required(v,'hours-basis'),costBasis:required(v,'cost-basis')});
  }
  if(action==='inspect-package')return inspectEconomicsPackage({...native,directory:absolute(required(v,'from')),
    expectedManifestSha256:required(v,'sha256'),...selected(v)});
  if(action==='receive'){
    required(v,'source-dir');
    return withSources(v,environment,({sourceDelivery})=>receiveEconomicsCase({...native,sourceDelivery,
      directory:absolute(required(v,'from')),receivingDirectory:absolute(required(v,'out')),
      casesDirectory:absolute(required(v,'cases-dir')),requestId:required(v,'request-id'),actor:required(v,'actor'),
      expectedManifestSha256:required(v,'sha256'),...selected(v)}));
  }
  const location=caseSelection(v),directory=location.casesDirectory;
  if(action==='inspect')return inspectEconomicsCase({...location,...selected(v)});
  if(action==='export')return withSources(v,environment,({store,sourceDelivery})=>exportEconomicsCase({
    ...native,...location,...selected(v),store,sourceDelivery,directory:absolute(required(v,'out')),
    exportId:required(v,'export-id'),generatedAt:v['generated-at']}));
  if(action==='handoff')return exportEconomicsHandoff({...location,...selected(v),directory:absolute(required(v,'out')),
    ...(v.acceptance!==undefined?{acceptanceId:v.acceptance}:{}),
    ...(v['acceptance-sha']!==undefined?{acceptanceSha256:v['acceptance-sha']}:{})});
  const model=openCaseCommercial({store:await openCaseStore(directory),workspaceId:commercialWorkspaceId(directory)});
  const base={id:location.id,expectedRevision:location.revision};
  if(action==='list'){
    const value=await model.read({id:location.id,revision:location.revision});
    return {scope:value.scope,case:value.case,economics:value.economics};
  }
  if(action==='seed'){
    const view=await model.read({id:location.id,revision:location.revision});
    const quote=view.quotes.find(row=>row.id===required(v,'quote'));
    if(!quote||quote.sha256!==required(v,'quote-sha'))throw new Error('Select the exact original quote.');
    const value=emptyCommercialEconomicsInput(quote,{asOfDate:required(v,'as-of')});
    // Seed from the selected saved edition without changing the live case.
    normalizeCommercialEconomicsInput(value);
    return {input:value,file:await save(required(v,'out'),jsonBytes(value))};
  }
  if(action==='preview'||action==='save'){
    const value=await input(v);
    if(action==='save')return model.saveEconomics({...base,input:value,requestId:required(v,'request-id'),
      actor:required(v,'actor'),reviewSha256:required(v,'review-sha')});
    const result=await model.previewEconomics({...base,input:value});
    return v.out?{...result,file:await save(v.out,jsonBytes(result))}:result;
  }
  const view=await model.read({id:location.id,revision:location.revision});
  const assessment=view.economics.assessments.find(row=>row.id===required(v,'assessment'));
  if(!assessment||assessment.sha256!==required(v,'assessment-sha'))throw new Error('Select the exact original assessment.');
  const result=await model.downloadEconomics({id:location.id,revision:location.revision,
    assessmentId:assessment.id,kind:required(v,'kind')});
  if(result.body.length!==result.descriptor.bytes||sha256(result.body)!==result.descriptor.sha256)
    throw new Error('The complete native download differs from its original descriptor.');
  const {body,...rest}=result;return {...rest,file:await save(required(v,'out'),body)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(jsonBytes(await commercialEconomicsCli()));}
  catch(error){process.stderr.write(JSON.stringify({error:error.code??'COMMERCIAL_ECONOMICS_FAILED',
    detail:error.message,...(error.currentRevision?{currentRevision:error.currentRevision}:{})})+'\n');process.exitCode=1;}
}
