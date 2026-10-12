// MIT. Trusted QuestDB adapter for the original retained publisher.
import { openQuestDbSourceFile } from '../config.mjs';
import { captureQuestDbPublicationPlan, inspectQuestDbPublicationSource, checkQuestDbDatasetColumnTypes,
  encodeQuestDbDatasetRow, validateQuestDbExtraction } from './plan.mjs';
export function createQuestDbPublisherDriver({captureDirectory}={}){
  return Object.freeze({sourceName:'QuestDB',workspaceSchema:'stellar-forge.questdb-publisher-workspace.v1',
    statusSchema:'stellar-forge.questdb-publisher-status.v1',candidateSchema:'stellar-forge.questdb-publisher-candidate.v1',
    capturePlan:captureQuestDbPublicationPlan,inspectSource:inspectQuestDbPublicationSource,
    openSource:(filename,options={})=>openQuestDbSourceFile(filename,{...options,...(captureDirectory?{captureDirectory}:{})}),
    checkColumnTypes:checkQuestDbDatasetColumnTypes,encodeRow:encodeQuestDbDatasetRow,validateExtraction:validateQuestDbExtraction});
}
export const questDbPublisherDriver=createQuestDbPublisherDriver();
