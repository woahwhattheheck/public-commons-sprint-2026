// SPDX-License-Identifier: MIT
// Read already committed original publications/exports; no analysis or source acquisition.
import {join} from 'node:path';
import {identity,json,stable,need,hash,selected,descriptor,exactFile,fileJSON,retainedPath} from './common.mjs';
import {inspectProjectManifest} from '../transfer.mjs';
import {validateSourceEdition,inspectRetainedFile} from '../../portable.mjs';
export function freezePublicationSelection(state,payload){
  const publication=selected(state.analysisPublications,payload.publicationId,'approved analysis publication'),
    exported=selected(state.analysisExports,payload.exportId,'completed original project export'),
    operation=state.operations[exported.id],review=[...(state.reviews??[])].reverse().find(r=>r.editionId===publication.editionId);
  hash(payload.expectedPublicationSha256);hash(payload.expectedArchiveSha256);
  need(identity(publication)===payload.expectedPublicationSha256&&exported.file?.sha256===payload.expectedArchiveSha256,
    'SOURCE_CHANGED','The selected publication or complete archive changed after review.');
  need(exported.projectId===publication.projectId&&exported.originalWorkspaceId===state.workspaceId&&
    operation?.state==='COMPLETE'&&operation.action==='analysis.export'&&operation.payload.projectId===publication.projectId,
    'ORIGINAL_EXPORT','Select a completed project export from this original workspace.');
  need(review?.decision==='accept'&&identity(review)===publication.sourceReviewSha256,
    'SOURCE_REVIEW','The exact publication source review is no longer the current accepted review.');
  const selection=operation.context?.analysis?.snapshotSelection;
  need(selection&&selection.project.id===publication.projectId&&selection.publications.some(r=>stable(r)===stable(publication)),
    'EXPORT_PUBLICATION','The complete export does not contain this exact publication. Create an explicit original project export that includes it.');
  return {workspaceId:state.workspaceId,publication,exported,exportOperation:{operationId:operation.operationId,
    requestSha256:operation.requestSha256,resultSha256:operation.resultSha256,createdAt:operation.createdAt,completedAt:operation.completedAt},review};
}
export function currentReviewMatches(state,source){
  const review=[...(state.reviews??[])].reverse().find(r=>r.editionId===source.publication.editionId);
  need(review?.decision==='accept'&&identity(review)===source.publication.sourceReviewSha256,
    'SOURCE_REVIEW','The exact accepted source review changed while this new seller offer was being prepared.');
}
export function sourceBinding(source){
  return {originalWorkspaceId:source.transfer.originalWorkspaceId,projectId:source.publication.projectId,
    publicationId:source.publication.id,publicationSha256:identity(source.publication),versionId:source.publication.versionId,
    editionId:source.publication.editionId,sourceReviewSha256:source.publication.sourceReviewSha256,
    exportId:source.exported.id,manifestSha256:source.exported.manifestSha256,snapshotSha256:source.exported.snapshotSha256,
    archive:{bytes:source.exported.file.bytes,sha256:source.exported.file.sha256}};
}
export async function verifyPublicationFiles(store,publication){
  need(publication.schema==='stellar-forge.sensorthings-analysis-publication.v1'&&Array.isArray(publication.files),
    'PUBLICATION','Use the original immutable analysis publication.');
  const byName=new Map();
  for(const file of publication.files){descriptor(file);need(!byName.has(file.name),'PUBLICATION_FILE','The original publication repeats a filename.');byName.set(file.name,file);}
  const manifestFile=byName.get(publication.manifestFile),selectedFile=byName.get('selected-view.json');
  need(manifestFile&&selectedFile&&byName.has(publication.reportFile),'PUBLICATION_FILE','The complete publication manifest, selected view or brief is absent.');
  const {value:manifest}=await fileJSON(store,manifestFile),{value:view}=await fileJSON(store,selectedFile);
  need(manifest.schema==='stellar-forge.sensorthings-analysis-publication-manifest.v1'&&
    identity(manifest)===publication.manifestSha256&&manifest.id===publication.id&&manifest.projectId===publication.projectId&&
    manifest.versionId===publication.versionId&&manifest.editionId===publication.editionId&&
    stable(manifest.selection)===stable(publication.selection)&&stable(manifest.sourceReview)===stable(publication.sourceReview)&&
    identity(manifest.sourceReview)===publication.sourceReviewSha256,'PUBLICATION_MANIFEST','The original publication manifest has different source/review bindings.');
  const originals=publication.files.filter(f=>f.name!==publication.manifestFile);
  need(stable(manifest.files)===stable(originals),'PUBLICATION_CLOSURE','The original publication file inventory differs from its manifest.');
  need(view.schema==='stellar-forge.sensorthings-analysis-publication-selection.v1'&&view.version.id===publication.versionId&&
    view.version.projectId===publication.projectId&&view.version.editionId===publication.editionId&&
    identity((({id,...body})=>body)(view.version))===view.version.id&&
    view.edition.id===publication.editionId&&stable(view.review)===stable(publication.sourceReview)&&
    stable(view.version.selection)===stable(publication.selection)&&
    view.summary.editionId===publication.editionId&&stable(view.summary.selection)===stable(publication.selection),
    'SELECTED_VIEW','The retained brief selection differs from its exact original version/source/review.');
  validateSourceEdition(view.edition);
  for(const file of publication.files)await inspectRetainedFile(retainedPath(store,file),{expectedBytes:file.bytes,expectedSha256:file.sha256,maximum:2*1024*1024*1024});
  return {manifest,view};
}
export async function describeFrozenSource(store,selection){
  const {publication,exported}=selection;descriptor(exported.file);
  const result=JSON.parse((await store.object(selection.exportOperation.resultSha256)).toString('utf8'));
  need(stable(result)===stable(exported),'EXPORT_RESULT','The original export result differs from its completed workspace record.');
  const {manifest,view}=await verifyPublicationFiles(store,publication),
    transfer=await inspectProjectManifest(store,{path:retainedPath(store,exported.file),expectedSha256:exported.file.sha256,expectedBytes:exported.file.bytes});
  const original=transfer.manifest.snapshot.publications.find(p=>p.id===publication.id);
  need(transfer.manifest.id===exported.id&&identity(transfer.manifest)===exported.manifestSha256&&
    transfer.manifest.snapshotSha256===exported.snapshotSha256&&transfer.manifest.originalWorkspaceId===selection.workspaceId&&
    transfer.manifest.snapshot.project.id===publication.projectId&&stable(original)===stable(publication),
    'PROJECT_EXPORT','The exact original project archive does not contain the selected immutable publication.');
  return {publication:structuredClone(publication),exported:structuredClone(exported),exportOperation:selection.exportOperation,
    transfer:{schema:transfer.manifest.schema,id:transfer.manifest.id,originalWorkspaceId:transfer.manifest.originalWorkspaceId,
      manifestSha256:identity(transfer.manifest),snapshotSha256:transfer.manifest.snapshotSha256,
      headVersionId:transfer.manifest.snapshot.project.headVersionId,sourceEditions:transfer.manifest.snapshot.editions.map(x=>x.edition.id),
      files:transfer.files,objects:transfer.objects,inspection:transfer.inspection},
    meaning:manifest.meaning,sourceTerms:structuredClone(manifest.source),summary:structuredClone(view.summary)};
}
export async function inspectIncomingProject(store,{path,expectedSha256,expectedBytes,publicationId,expectedPublicationSha256}){
  hash(expectedSha256);hash(expectedPublicationSha256);
  const inspected=await inspectProjectManifest(store,{path,expectedSha256,expectedBytes}),m=inspected.manifest,
    publication=selected(m.snapshot.publications,publicationId,'publication in the delivered project');
  need(identity(publication)===expectedPublicationSha256,'INCOMING_PUBLICATION','The delivered publication differs from the selected original identity.');
  return {manifest:m,publication,binding:{originalWorkspaceId:m.originalWorkspaceId,projectId:m.snapshot.project.id,
    publicationId,publicationSha256:identity(publication),versionId:publication.versionId,editionId:publication.editionId,
    sourceReviewSha256:publication.sourceReviewSha256,exportId:m.id,manifestSha256:identity(m),snapshotSha256:m.snapshotSha256,
    archive:{bytes:expectedBytes,sha256:expectedSha256}},inspection:inspected.inspection};
}
