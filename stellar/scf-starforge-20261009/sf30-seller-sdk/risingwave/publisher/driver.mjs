// MIT. Trusted source adapter for the maintained publisher and scheduler.
import { openRisingWaveSourceFile } from '../config.mjs';
import { captureRisingWavePublicationPlan,inspectRisingWavePublicationSource,checkRisingWaveDatasetColumnTypes,
  encodeRisingWaveDatasetRow,validateRisingWaveExtraction } from './plan.mjs';
export function createRisingWavePublisherDriver({captureDirectory}={}){
  return Object.freeze({sourceName:'RisingWave',workspaceSchema:'stellar-forge.risingwave-publisher-workspace.v1',
    statusSchema:'stellar-forge.risingwave-publisher-status.v1',candidateSchema:'stellar-forge.risingwave-publisher-candidate.v1',
    capturePlan:captureRisingWavePublicationPlan,inspectSource:inspectRisingWavePublicationSource,
    async openSource(filename,options={}){
      const opened=await openRisingWaveSourceFile(filename,{...options,...(captureDirectory?{captureDirectory}:{})});
      try{await opened.source.preflight();return opened;}catch(issue){await opened.source.close();throw issue;}
    },
    checkColumnTypes:checkRisingWaveDatasetColumnTypes,encodeRow:encodeRisingWaveDatasetRow,validateExtraction:validateRisingWaveExtraction});
}
export const risingWavePublisherDriver=createRisingWavePublisherDriver();
