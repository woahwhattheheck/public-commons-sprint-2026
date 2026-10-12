// MIT. Exact HUD source context for the original publisher/customer handoff.
import { join } from 'node:path';
import { identity,fault } from '../postgres/publisher/files.mjs';
import { readHudSource,publicSelection } from './release.mjs';

export async function hudPublicationHandoff(publisher,id){
  const run=publisher.run(id),candidate=await publisher.candidate(id),plan=publisher.plan(run.plan);
  const source=await readHudSource(join(publisher.directory,'plans',plan.folder,'source.json'));
  if(source.manifest.releaseId!==plan.data.releaseId||source.manifest.releaseId!==candidate.manifest.extraction.observation.releaseId||
    identity(plan.data.input)!==candidate.manifest.extraction.observation.selectionHash)
    throw fault('HUD_PUBLICATION_SOURCE_CHANGED');
  const selected=publicSelection(source,plan.data.input);
  if(selected.rowCount!==candidate.manifest.dataset.rowCount)throw fault('HUD_PUBLICATION_ROW_COUNT_CHANGED');
  return {schema:'stellar-forge.hud-publication-handoff.v1',runId:id,state:run.state,
    source:selected,publication:run.data.publication??null,review:run.data.review??null,
    candidate:{snapshot:candidate.manifest.dataset.snapshot,csvSha256:candidate.manifest.csvHash,
      configSha256:candidate.manifest.configHash,rowCount:candidate.manifest.dataset.rowCount,
      candidateDigest:candidate.manifest.candidateDigest,configPath:candidate.configPath},
    receiver:{key:['fiscal_year','locality_id','metric','family_size'],value:'published_income_usd',
      originalValue:'source_value',cell:['source_sheet','source_cell'],county:'county_fips',area:['hud_area_code','hud_area_name'],
      sourceProgram:'HUD Section 8 Income Limits',unit:'annual USD',additive:false,
      familySizeForMedian:null,countySelection:'Preserve every original HUD locality in the selected county.'}};
}
export async function prepareHudCustomer(publisher,id,input){
  const handoff=await hudPublicationHandoff(publisher,id);
  const prepared=await publisher.prepareBuyer(id,input);
  if(prepared.snapshot!==handoff.candidate.snapshot)throw fault('HUD_CUSTOMER_SNAPSHOT_CHANGED');
  return {...prepared,hud:{releaseId:handoff.source.release.releaseId,
    fiscalYear:handoff.source.release.fiscalYear,effectiveDate:handoff.source.release.effectiveDate,
    selection:handoff.source.selection,selectionHash:handoff.source.selectionHash,
    workbookSha256:handoff.source.release.files.workbook.sha256,rowCount:handoff.candidate.rowCount,
    snapshot:handoff.candidate.snapshot,receiver:handoff.receiver}};
}
