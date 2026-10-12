// MIT. Use the existing authenticated attachment and retained-export receiver.
import {exact,failure} from './host-files.mjs';
import {parseJson,object} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';
import {createRiskOfBiasClient} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/risk-of-bias/client.mjs';
import {RESEARCH_RISK_EXPORTS,RESEARCH_RISK_REQUEST_FIELDS} from './catalog/research-risk-of-bias.mjs';
export {RESEARCH_RISK_PREFIX} from './catalog/research-risk-of-bias.mjs';

const fields=['reviewId','assessmentId','assessmentEditionId','actorId','revision'];
const selected=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
export async function callResearchRiskOfBias(client,name,args){
  const risk=createRiskOfBiasClient(client);
  if(name==='merchant_research_risk_view'){
    exact(args,['workspace','dossierId',...fields,'section','offset','limit'],['workspace','dossierId']);
    return risk.view(args.dossierId,selected(args,[...fields,'section','offset','limit']));
  }
  if(name!=='merchant_research_risk_review')throw failure('TOOL_NOT_FOUND','Unknown original appraisal operation.');
  exact(args,['workspace','dossierId',...RESEARCH_RISK_REQUEST_FIELDS],
    ['workspace','dossierId','requestId','expectedRevision','actor','action','dataJson']);
  if(typeof args.dataJson!=='string'||Buffer.byteLength(args.dataJson)>16*1024*1024)
    throw failure('INVALID_PARAMS','Use the complete retained action data within the original request limit.');
  const data=parseJson(Buffer.from(args.dataJson));
  if(!object(data))throw failure('INVALID_PARAMS','Appraisal action data is one complete original JSON object.');
  const request={...selected(args,RESEARCH_RISK_REQUEST_FIELDS.filter(key=>key!=='dataJson')),data};
  return risk.review(args.dossierId,request);
}
export async function exportResearchRiskOfBias(client,args,{file,download=work=>work()}={}){
  exact(args,['workspace','dossierId','kind',...fields,'riskSection','expectedSha256'],
    ['workspace','dossierId','kind']);
  const spec=RESEARCH_RISK_EXPORTS[args.kind];
  if(!spec)throw failure('INVALID_PARAMS','Select one original appraisal export kind.');
  const options={...selected(args,fields),section:args.riskSection??'overview',format:spec.riskFormat,
    file,...selected(args,['expectedSha256'])};
  const result=await download(()=>createRiskOfBiasClient(client).export(args.dossierId,options));
  const selection={dossierId:args.dossierId,...selected(args,fields),
    revision:result.revision,section:options.section,format:options.format};
  return {result,selection};
}
