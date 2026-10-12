// MIT. Explicit saved MultiDatastream selections for the original Python document intake.
// No provider requests, store, queue, database, or alternate number interpretation.
import {identity,json,stable,fault} from '../contract.mjs';
import {validateComponentBindings,selectedComponentRows,componentExactEligibility,componentNumericEligibility,
  COMPONENT_COLUMNS,COMPONENT_MEANING} from './components.mjs';

export const PYTHON_COMPONENT_INTAKE_SCHEMA='stellar-forge.sensorthings-python-component-intake.v1';
export const PYTHON_COMPONENT_BINDINGS_SCHEMA='stellar-forge.sensorthings-python-component-bindings.v1';
export const PYTHON_COMPONENT_TABLES=Object.freeze({
  selected_components:COMPONENT_COLUMNS,
  component_index:Object.freeze(['component_occurrence_id','parent_occurrence_id','original_key','original_key_state',
    'semantic_sha256','parent_semantic_sha256','component_series_key','component_binding_id','component_meaning_id',
    'source_stream_key','component_index','source_page_sha256','source_pointer','component_source_pointer']),
  component_eligibility:Object.freeze(['component_occurrence_id','exact_eligible','exact_reason','browser_eligible','browser_reason','method']),
  component_bindings:Object.freeze(['source_stream_key','component_series_key','component_index','component_binding_id',
    'component_meaning_id','component_name','choice_json','descriptor_json','binding_json','stream_json'])
});
const HASH=/^[a-f0-9]{64}$/;
const fail=message=>{throw fault('ANALYSIS_PYTHON_COMPONENT_BINDING',message,409);};
/** A saved native version, never an inferred first component or mutable UI form. */
export async function prepareComponentProjection(store,edition,version){
  if(!version||version.schema!=='stellar-forge.sensorthings-analysis-version.v1'||
      version.editionId!==edition.id||!HASH.test(version.id??'')||!/^analysis-[a-f0-9]{24}$/.test(version.projectId??'')||
      !Array.isArray(version.selection?.componentSelections))
    fail('Select an immutable component analysis version of this exact original source edition.');
  const {id,...body}=version;
  if(identity(body)!==id)fail('The saved analysis version differs from its complete original content.');
  const {bound}=await validateComponentBindings(store,edition,version.selection),
    bindings=bound.map(({choice,descriptor,stream})=>({
      choice,descriptor,bindingJson:stable(descriptor.binding),
      // Keep the complete original metadata context; scalar browser compatibility
      // is not used as a condition for exact source preparation.
      stream:{streamKey:stream.streamKey,streamId:stream.streamId,sourceIdentity:stream.sourceIdentity,
        name:stream.name,description:stream.description,sourceRef:stream.sourceRef,sourceJson:stream.sourceJson,
        observationType:stream.observationType,metadataCounts:stream.metadataCounts,metadataAligned:stream.metadataAligned,
        issues:stream.issues,duplicatePropertyIdsRetained:stream.duplicatePropertyIdsRetained}
    })),
    manifest={schema:PYTHON_COMPONENT_BINDINGS_SCHEMA,editionId:edition.id,analysisVersionId:version.id,
      projectId:version.projectId,selection:version.selection,bindings,meaning:COMPONENT_MEANING,
      methods:{projection:'original-selectedComponentRows',exact:'original-componentExactEligibility',
        browser:'original-componentNumericEligibility',sourceCells:'unchanged source strings',
        comparison:'selected semantic identity and independent parent semantic identity',
        time:'Explicit source instants and intervals only; no inferred cadence, duration or gap filling.'}},
    metadata={schema:'stellar-forge.sensorthings-python-component-selection.v1',
      analysisVersionId:version.id,projectId:version.projectId,editionId:edition.id,
      selection:version.selection,bindingIds:bindings.map(x=>x.descriptor.bindingId),
      bindingManifestId:identity(manifest),tables:Object.keys(PYTHON_COMPONENT_TABLES)};
  async function* rows(table){
    if(table==='component_bindings'){
      for(const item of bindings){
        const {choice,descriptor}=item;
        yield {row:{source_stream_key:choice.streamKey,component_series_key:descriptor.seriesKey,
          component_index:String(choice.index),component_binding_id:descriptor.bindingId,component_meaning_id:descriptor.meaningId,
          component_name:descriptor.name,choice_json:JSON.stringify(choice),descriptor_json:JSON.stringify(descriptor),
          binding_json:item.bindingJson,stream_json:JSON.stringify(item.stream)}};
      }
      return;
    }
    if(!Object.hasOwn(PYTHON_COMPONENT_TABLES,table))fail('Choose an original declared component table.');
    for await(const item of selectedComponentRows(store,edition,version.selection)){
      const {row,original}=item;
      if(table==='selected_components'){yield {row};continue;}
      if(!HASH.test(row.component_occurrence_id??'')||original.componentOccurrenceId!==row.component_occurrence_id||
          original.occurrenceId!==row.occurrence_id||!HASH.test(original.semanticHash??'')||
          !HASH.test(original.parentSemanticHash??'')||
          !(original.key===null||typeof original.key==='string'))
        fail('The component occurrence lost its original parent or selected semantic identity.');
      if(table==='component_index'){
        yield {row:{component_occurrence_id:row.component_occurrence_id,parent_occurrence_id:row.occurrence_id,
          original_key:original.key??'',original_key_state:original.key===null?'missing':'value',
          semantic_sha256:original.semanticHash,parent_semantic_sha256:original.parentSemanticHash,
          component_series_key:row.component_series_key,component_binding_id:row.component_binding_id,
          component_meaning_id:row.component_meaning_id,source_stream_key:row.source_stream_key,
          component_index:row.component_index,source_page_sha256:row.source_page_sha256,
          source_pointer:row.source_pointer,component_source_pointer:row.component_source_pointer}};
      }else{
        const exact=componentExactEligibility(row),browser=componentNumericEligibility(row);
        yield {row:{component_occurrence_id:row.component_occurrence_id,
          exact_eligible:String(exact.eligible),exact_reason:exact.reason??'eligible',
          browser_eligible:String(browser.eligible),browser_reason:browser.reason??'eligible',
          method:'original-componentExactEligibility+componentNumericEligibility'}};
      }
    }
  }
  return {metadata,version,manifest,tableColumns:PYTHON_COMPONENT_TABLES,rows};
}
