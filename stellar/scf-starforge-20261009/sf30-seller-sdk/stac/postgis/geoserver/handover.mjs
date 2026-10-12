// MIT. Complete original operator custody, immutable receiving and same-service adoption.
import { join, resolve, relative } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { acquireStateLease } from '../../../../merchant-fleet-gateway/state-lease.mjs';
import { readJson, bytes, digest, identity, syncDirectory } from '../../../postgres/publisher/files.mjs';
import { durableDirectory, exactFile, readWfsDocument } from '../../../wfs/source.mjs';
import { readCapture } from '../../../ogc/source.mjs';
import { need, absolute, hash, relativeFile, normalizeProfile, publicProfile, RECEIVING_SCHEMA, MiB } from './contract.mjs';
import { walkFiles, retainCopy, optionalJson, readReceiving, inspectGeoServerHandover } from './journal.mjs';

function separate(a,b){
  const inside=(parent,child)=>{const value=relative(parent,child);return !value||(!value.startsWith('../')&&value!=='..');};
  need(!inside(a,b)&&!inside(b,a),'GEOSERVER_HANDOVER_DIRECTORY',
    'Use a separate canonical directory for the portable operator.');
}
const OMIT=new Set(['lease.lock','workspace.lock','private-objects','export-checkpoints','receiving-adoption.json','console-connection.json']);
function include(path,entry){
  return path.split('/').some(part=>part.startsWith('.')||OMIT.has(part))||
    /(?:^|\/)(?:lock\.json|lock\.recovery|\.lease|writer\.lock)$/.test(path);
}
const guide=String.raw`# GeoServer publication operator

This package retains the selected PostGIS receiving source, the actual service
requests and complete responses, WFS capability/schema/feature captures, PNG
maps, reviewed resource snapshots, and the original publication/rollback journal.

## Open the delivered result

Run the installed GeoServer command with:

    starforge geoserver inspect-handover --directory PATH --manifest-sha256 EXPECTED_SHA256

The inspector checks every member, the original PostGIS receipt, native WFS
schema/capture records, and the retained operation identities.

## Resume the same service

Adopt the package into an empty private directory:

    starforge geoserver adopt --directory PATH --out OPERATOR --manifest-sha256 EXPECTED_SHA256

Then reopen its original host configuration:

    starforge geoserver serve --workspace OPERATOR \
      --profile OPERATOR/host/geoserver-profile.json \
      --reader OPERATOR/host/postgis-reader.json --port 0

Supply the named credentials in the receiving host's environment. The portable
configuration retains references only. Existing CA-file paths belong to the
host's original PostgreSQL connection profile; provide the same selected CA
file on the receiving host when that profile declares it.

The original GeoServer base URL, workspace, datastore and PostGIS reader are
fixed by the retained profile. Applying a saved operation verifies the current
native database edition and compares each selected resource with its retained
before/after state. Continue the original operation ID and review hash.
Use a new reviewed operation for a newer accepted database receipt.

## Refresh and rollback

A refresh consumes the original PostGIS controller's new accepted receipt.
Prepare the full layer selection with kind "refresh" and expectedPublication
set to the current publication ID. Review the native difference, then apply.

For selective rollback, reconcile the original publication first. Prepare a
new rollback operation naming it and the currently accepted original PostGIS
receipt. Apply that reviewed rollback. The operator restores its recorded
fields only when the actual service still matches its applied value; a later
edit remains visible as a conflict. The PostGIS controller owns database
rollback separately.

The service reader connects using the datastore's observed read-only database
role. GeoServer read/write ACL roles are separate service identities. Existing
workspace administration rules remain in the retained service snapshot.

## Source and runtime

The implementation is in the maintained Starforge repository under
sf30-seller-sdk/stac/postgis/geoserver/. Use the complete installed distribution,
Node 22.16 or later, Python 3, and the original PostGIS runtime with pg/pg-cursor.
The operator reuses the original WFS/OGC source capture, native PostGIS verifier,
SF31 HTTPS transport and kernel lease. Source publication is carried with the
parent PostGIS customer handover.
`;
export async function exportPublication({journal,request,review,state,directory,signal}){
  directory=absolute(directory);separate(journal.directory,directory);
  const claim={schema:'starforge.geoserver-export-request.v1',operationId:state.id,
    projectId:request.projectId,requestSha256:state.requestSha256,reviewSha256:state.reviewSha256,
    postgisManifestSha256:request.manifestSha256};
  const exportId=identity(claim),snapshotDirectory=join(journal.directory,'export-checkpoints',exportId);
  await durableDirectory(snapshotDirectory);await durableDirectory(directory);
  await exactFile(join(directory,'request.json'),bytes(claim));
  const complete=await optionalJson(join(directory,'geoserver-receiving.json'));
  if(complete){
    need(complete.exportId===exportId&&complete.operationId===state.id,'GEOSERVER_EXPORT_SELECTION_CHANGED');
    return inspectGeoServerReceiving(directory,{signal});
  }
  let selection=await optionalJson(join(snapshotDirectory,'selection.json'));
  if(!selection){
    const original=await walkFiles(journal.directory,{signal,skip:include}),files=[];
    for(const file of original){
      signal?.throwIfAborted();
      // Freeze small mutable metadata before publishing the complete selection.
      // Large source bodies and content-addressed objects remain their immutable originals.
      let source=file.path;
      if(file.path.endsWith('.json')&&file.bytes<=64*MiB){
        const content=await readFile(join(journal.directory,file.path));
        need(content.length===file.bytes&&digest(content)===file.sha256,'GEOSERVER_EXPORT_SOURCE_CHANGED');
        const frozen=await journal.object(content,{contentType:'application/json'});source='objects/'+frozen.sha256;
      }
      files.push({path:'operator/'+file.path,source,bytes:file.bytes,sha256:file.sha256});
    }
    const instructions=Buffer.from(guide),source=await journal.object(instructions,{contentType:'text/markdown'});
    files.push({path:'OPERATOR.md',source:'objects/'+source.sha256,bytes:source.bytes,sha256:source.sha256});
    selection={schema:'starforge.geoserver-export-selection.v1',exportId,claim,
      createdAt:new Date().toISOString(),files:files.sort((a,b)=>a.path.localeCompare(b.path))};
    await journal.file(join(snapshotDirectory,'selection.json'),bytes(selection));
  }
  need(selection.exportId===exportId&&sameClaim(selection.claim,claim),'GEOSERVER_EXPORT_SELECTION_CHANGED');
  for(const file of selection.files){
    signal?.throwIfAborted();journal.assertHeld();
    await retainCopy(join(journal.directory,relativeFile(file.source)),join(directory,relativeFile(file.path)),file,{signal});
  }
  const manifest={schema:RECEIVING_SCHEMA,exportId,operationId:state.id,projectId:request.projectId,
    requestSha256:state.requestSha256,reviewSha256:state.reviewSha256,kind:request.kind,
    postgisManifestSha256:request.manifestSha256,
    service:request.profile,createdAt:selection.createdAt,
    originalPrivateResponses:'Datastore credential-bearing responses remain in the original private host.',
    files:selection.files.map(({source,...file})=>file)};
  await exactFile(join(directory,'geoserver-receiving.json'),bytes(manifest));await syncDirectory(directory);
  return inspectGeoServerReceiving(directory,{signal});
}
const sameClaim=(left,right)=>identity(left)===identity(right);
export async function inspectGeoServerReceiving(directory,{expectedManifestSha256,signal}={}){
  const output=await inspectGeoServerHandover(directory,{expectedManifestSha256,signal});
  const {manifest}=output,root=join(directory,'operator');
  const members=new Map(manifest.files.map(file=>[file.path,file]));
  need(manifest.files.every(file=>file.path==='OPERATOR.md'||file.path.startsWith('operator/')),
    'GEOSERVER_HANDOVER_MEMBER_SCOPE');
  const requireMember=path=>need(members.has('operator/'+path),'GEOSERVER_HANDOVER_UNBOUND_MEMBER',path);
  async function inventory(parent,prefix=''){
    for(const entry of await readdir(parent,{withFileTypes:true})){
      signal?.throwIfAborted();const path=prefix+entry.name;
      need(!include(path)&&!entry.isSymbolicLink(),'GEOSERVER_HANDOVER_MEMBER_FORBIDDEN');
      if(entry.isDirectory())await inventory(join(parent,entry.name),path+'/');
      else{need(entry.isFile(),'GEOSERVER_HANDOVER_MEMBER');requireMember(path);}
    }
  }
  await inventory(root);
  for(const path of ['workspace.json','host/geoserver-profile.json','host/postgis-reader.json',
    ...['state.json','request.json','review.json'].map(name=>'operations/'+manifest.operationId+'/'+name)])requireMember(path);
  const state=await readJson(join(root,'operations',manifest.operationId,'state.json'),64*MiB);
  const request=await readJson(join(root,'operations',manifest.operationId,'request.json'),64*MiB);
  const review=await readJson(join(root,'operations',manifest.operationId,'review.json'),64*MiB);
  const workspace=await readJson(join(root,'workspace.json'),262144);
  const profileBytes=await readFile(join(root,'host','geoserver-profile.json')),
    readerBytes=await readFile(join(root,'host','postgis-reader.json'));
  const profile=normalizeProfile(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(profileBytes)));
  const nativeBinding={schema:'starforge.geoserver-native-reader-binding.v1',
    profileSha256:digest(profileBytes),readerSha256:digest(readerBytes)};
  need(identity(workspace.nativeBinding)===identity(nativeBinding)&&
    workspace.profileSha256===identity({profile,nativeBinding})&&
    identity(workspace.profile)===identity(publicProfile(profile))&&
    identity(request.profile)===identity(workspace.profile),'GEOSERVER_HANDOVER_HOST_BINDING');
  need(state.id===manifest.operationId&&state.requestSha256===manifest.requestSha256&&
    identity(request)===manifest.requestSha256&&identity(review)===manifest.reviewSha256&&
    state.reviewSha256===manifest.reviewSha256&&request.projectId===manifest.projectId&&
    state.profileSha256===workspace.profileSha256&&request.manifestSha256===manifest.postgisManifestSha256,
    'GEOSERVER_HANDOVER_OPERATION_CHANGED');
  requireMember('receipts/'+manifest.postgisManifestSha256+'/postgis-receiving.json');
  const original=await readReceiving(join(root,'receipts',manifest.postgisManifestSha256),
    manifest.postgisManifestSha256,{signal});
  need(original.receipt.projectId===manifest.projectId,'GEOSERVER_HANDOVER_POSTGIS_CHANGED');
  for(const member of original.receipt.files)requireMember('receipts/'+manifest.postgisManifestSha256+'/'+member.path);
  const native=[];
  if(state.receiving){
    need(state.receiving.operationId===state.id&&state.receiving.reviewSha256===state.reviewSha256,
      'GEOSERVER_HANDOVER_RECEIVING_CHANGED');
    const receivingRoot=join(root,'operations',state.id,'receiving');
    for(const service of state.receiving.services)for(const layer of service.layers){
      signal?.throwIfAborted();
      if(layer.enabled){
        const schema=await readWfsDocument(join(receivingRoot,relativeFile(layer.schema.directory)));
        const capture=await readCapture(join(receivingRoot,relativeFile(layer.features.directory)));
        need(capture.complete&&capture.sourceId===layer.features.sourceId&&String(capture.rows)===layer.features.rows&&
          schema.record.id===layer.schema.record.id,'GEOSERVER_HANDOVER_NATIVE_CAPTURE_CHANGED');
        native.push({readerId:service.readerId,layerId:layer.layerId,sourceId:capture.sourceId,
          rows:layer.features.rows,pages:capture.pages.length,mapSha256:layer.map.response.body.sha256});
      }else native.push({readerId:service.readerId,layerId:layer.layerId,state:layer.state});
    }
  }else need(state.state==='ROLLED_BACK','GEOSERVER_HANDOVER_NATIVE_RECEIVING_REQUIRED');
  return {...output,operation:{id:state.id,state:state.state,kind:request.kind,projectId:manifest.projectId},
    postgis:{editionId:original.receipt.editionId,revision:original.receipt.revision},native};
}
export async function adoptGeoServerReceiving({directory,outputDirectory,expectedManifestSha256,signal}={}){
  directory=absolute(directory);outputDirectory=absolute(outputDirectory);separate(directory,outputDirectory);
  const source=await inspectGeoServerReceiving(directory,{expectedManifestSha256:hash(expectedManifestSha256),signal});
  await durableDirectory(outputDirectory);
  const lease=await acquireStateLease(outputDirectory);let originalError;
  try{
    const marker={schema:'starforge.geoserver-adoption.v1',manifestSha256:source.manifestSha256,
      exportId:source.manifest.exportId,operationId:source.manifest.operationId};
    const prior=await optionalJson(join(outputDirectory,'receiving-adoption.json'));
    const existing=(await readdir(outputDirectory)).filter(name=>name!=='lease.lock');
    need(prior?sameClaim(prior,marker):existing.length===0,'GEOSERVER_ADOPT_EMPTY_WORKSPACE',
      'Choose an empty directory or resume this same original adoption.');
    await exactFile(join(outputDirectory,'receiving-adoption.json'),bytes(marker));await syncDirectory(outputDirectory);
    for(const file of source.manifest.files){
      signal?.throwIfAborted();lease.assertHeld();
      if(!file.path.startsWith('operator/'))continue;
      const target=relativeFile(file.path.slice('operator/'.length));
      need(!include(target),'GEOSERVER_ADOPTION_MEMBER_FORBIDDEN');
      await retainCopy(join(directory,file.path),join(outputDirectory,target),file,{signal});
    }
    await syncDirectory(outputDirectory);
    return {schema:'starforge.geoserver-adoption-result.v1',directory:outputDirectory,
      manifestSha256:source.manifestSha256,operation:source.operation,
      profileFile:join(outputDirectory,'host','geoserver-profile.json'),
      readerFile:join(outputDirectory,'host','postgis-reader.json')};
  }catch(error){originalError=error;throw error;}
  finally{try{await lease.close();}catch(error){if(originalError)originalError.cleanupError=error;else throw error;}}
}
