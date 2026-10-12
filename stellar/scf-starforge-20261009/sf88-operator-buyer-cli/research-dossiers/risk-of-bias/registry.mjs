// MIT. Retain the original extraction registry's immutable result editions.
import {need,object} from '../../node/store.mjs';
import {studyExtractionModel,extractionPublicationContext} from '../study-extraction.mjs';

export function riskOfBiasRegistry(state,projected){
  const context=extractionPublicationContext(state,studyExtractionModel(state,projected));
  need(context.dossierId===state.id&&context.revision===state.revision&&Array.isArray(context.results),
    'RISK_OF_BIAS_EXTRACTION_CONTEXT_CHANGED');
  const identities=new Set();
  const results=context.results.map(row=>{
    need(object(row)&&object(row.record)&&typeof row.resultId==='string'&&typeof row.editionId==='string'&&
      typeof row.studyId==='string'&&typeof row.questionId==='string'&&typeof row.label==='string'&&
      Number.isSafeInteger(row.record.revision)&&row.record.revision>=1&&Array.isArray(row.sourceBindings)&&
      typeof row.current==='boolean'&&typeof row.status==='string','RISK_OF_BIAS_EXTRACTION_RESULT_INVALID');
    const key=row.resultId+'\n'+row.record.revision;
    need(!identities.has(key),'RISK_OF_BIAS_EXTRACTION_RESULT_DUPLICATE');identities.add(key);
    const occurrenceIds=[...new Set(row.sourceBindings.map(binding=>{
      need(typeof binding?.occurrenceId==='string'&&/^o_[a-f0-9]{64}$/.test(binding.occurrenceId),
        'RISK_OF_BIAS_EXTRACTION_SOURCE_INVALID');
      return binding.occurrenceId;
    }))];
    return {id:row.resultId,studyId:row.studyId,questionId:row.questionId,
      version:row.record.revision,name:row.label,occurrenceIds,record:row.record,
      editionId:row.editionId,current:row.current,status:row.status};
  });
  return {results};
}
