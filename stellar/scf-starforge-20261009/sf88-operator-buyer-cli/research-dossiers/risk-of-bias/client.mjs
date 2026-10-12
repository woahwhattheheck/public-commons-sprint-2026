// MIT. A typed appraisal facade over the original Research client.
import {BuyerError,need} from '../../node/store.mjs';
import {riskOfBiasInput,riskOfBiasDigest,RISK_OF_BIAS_SECTIONS} from './contracts.mjs';

export const RISK_OF_BIAS_VIEW_SCHEMA='sf88-research-risk-of-bias-view/v1';
const recovery='Read the original appraisal operations and retry the exact retained request ID, expected revision, actor and complete body.';
const integer=value=>Number.isSafeInteger(value)&&value>=1;
function readReceipt(value,dossierId,options){
  need(value?.schema===RISK_OF_BIAS_VIEW_SCHEMA&&value.dossierId===dossierId&&integer(value.revision)&&
    (options.revision===undefined||value.revision===options.revision)&&
    value.section===(options.section??'overview')&&
    (options.reviewId===undefined||value.reviewId===options.reviewId)&&
    (options.assessmentId===undefined||value.assessmentId===options.assessmentId)&&
    (options.assessmentEditionId===undefined||value.assessment?.editionId===options.assessmentEditionId)&&
    Array.isArray(value.items)&&Number.isSafeInteger(value.total)&&value.total>=0&&
    Number.isSafeInteger(value.offset)&&value.offset===(options.offset??0)&&
    Number.isSafeInteger(value.limit)&&value.limit>=1&&value.limit<=100&&
    value.items.length<=value.limit&&value.offset+value.items.length<=value.total&&
    (value.nextOffset===null?value.offset+value.items.length===value.total:
      value.nextOffset===value.offset+value.items.length&&value.nextOffset>value.offset&&value.nextOffset<value.total),
    'RISK_OF_BIAS_RESPONSE_CHANGED');
  return value;
}
function mutationReceipt(value,dossierId,request){
  const operation=value?.operation,digest=riskOfBiasDigest(request);
  if(value?.dossier?.id!==dossierId||!integer(value.dossier.revision)||typeof value.duplicate!=='boolean'||
    operation?.dossierId!==dossierId||operation?.requestId!==request.requestId||
    operation?.requestSha256!==digest||!operation.request||riskOfBiasDigest(operation.request)!==digest||
    operation?.originalRevision!==request.expectedRevision||operation?.revision!==request.expectedRevision+1||
    value.dossier.revision<operation.revision||operation.action!==request.action||
    (request.reviewId!==undefined&&operation.reviewId!==request.reviewId)){
    throw new BuyerError('RISK_OF_BIAS_RECEIPT_CHANGED',{
      outcomeUnknown:true,dossierId,requestId:request.requestId,requestSha256:digest,recovery,
    });
  }
  return value;
}
export function createRiskOfBiasClient(client){
  need(client&&['riskOfBias','reviewRiskOfBias','exportRiskOfBias'].every(key=>typeof client[key]==='function'),
    'RISK_OF_BIAS_CLIENT_REQUIRED');
  return Object.freeze({
    async view(dossierId,options={}){
      need(RISK_OF_BIAS_SECTIONS.includes(options.section??'overview'),'RISK_OF_BIAS_SECTION_INVALID');
      need(!options.offset||options.revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
      return readReceipt(await client.riskOfBias(dossierId,options),dossierId,options);
    },
    async review(dossierId,value){
      const request=riskOfBiasInput(value);
      let result;
      try{result=await client.reviewRiskOfBias(dossierId,request);}
      catch(error){
        if(error.outcomeUnknown)Object.assign(error,{
          dossierId,requestId:request.requestId,requestSha256:riskOfBiasDigest(request),recovery,
        });
        throw error;
      }
      return mutationReceipt(result,dossierId,request);
    },
    async export(dossierId,options={}){
      need(['json','csv','md','html'].includes(options.format??'json'),'RISK_OF_BIAS_EXPORT_FORMAT_INVALID');
      const result=await client.exportRiskOfBias(dossierId,options);
      if(typeof result?.file!=='string'||!Number.isSafeInteger(result.bytes)||result.bytes<0||
        !/^[a-f0-9]{64}$/.test(result.sha256??'')||!integer(result.revision)||
        (options.revision!==undefined&&result.revision!==options.revision)){
        throw new BuyerError('RISK_OF_BIAS_EXPORTED_FILE_CHANGED',{destinationPublished:true,file:result});
      }
      return result;
    },
  });
}
