// MIT. eoAPI receiving composes the original purchased STAC delivery and GIS export.
import {join,resolve} from 'node:path';
import {readJson,readBytes,jsonBytes,need,exists} from '../../../sf88-operator-buyer-cli/node/store.mjs';
import {canonicalJson,sha256,normalizeEndpoint} from '../provider.mjs';
import {StacDelivery} from '../customer.mjs';
import {StacFile,stacRetain} from '../merchant.mjs';
import {exportPortableStacDelivery,openPortableStacDelivery} from '../receiving/delivery.mjs';
import {validateDeploymentPolicyPackage} from './policy-workspace.mjs';

const SCHEMA='starforge.stac-eoapi-delivery.v1';
const MANIFEST='eoapi-delivery.json';
const HASH=/^[a-f0-9]{64}$/;
const hash=value=>sha256(canonicalJson(value));
const copy=value=>structuredClone(value);
const same=(left,right)=>hash(left)===hash(right);
const fixed=['eoapi/source-review.json','eoapi/delivery-review.json','eoapi/delivery-approval.json',
  'eoapi/policy/package.json','eoapi/OPERATOR.md'];
const identity=manifest=>({id:manifest.id,digest:manifest.digest,captureId:manifest.capture.id,
  files:manifest.files.map(item=>({path:item.path,bytes:item.bytes,sha256:item.sha256,mime:item.mime})),
  assets:manifest.assets.map(copy)});
function checkReview(record,schema) {
  need(record&&record.schema===schema&&HASH.test(record.sha256??''),'EOAPI_RECEIVED_REVIEW_INVALID');
  const {sha256:digest,...core}=record;need(hash(core)===digest,'EOAPI_RECEIVED_REVIEW_CHANGED');return record;
}
function checkContext(context,edition,members) {
  const {source,review,approval}=context;
  checkReview(source,'starforge.stac-eoapi-source-review.v1');
  checkReview(review,'starforge.stac-eoapi-delivery-review.v1');
  const policy=validateDeploymentPolicyPackage(source.policyPackage);
  need(source.ready&&source.source.ready&&source.approvalId===policy.approval.id&&
    source.policyDigest===policy.compilation.digest&&source.policyPackageDigest===policy.digest,'EOAPI_RECEIVED_SOURCE_POLICY_CHANGED');
  need(review.sourceReviewId===source.id&&review.sourceReviewSha256===source.sha256&&
    review.approvalId===source.approvalId&&review.policyDigest===source.policyDigest&&
    review.policyPackageDigest===source.policyPackageDigest,'EOAPI_RECEIVED_DELIVERY_SOURCE_CHANGED');
  need(approval?.reviewId===review.id&&approval.reviewSha256===review.sha256&&
    approval.editionDigest===review.edition.digest&&approval.policyPackageDigest===source.policyPackageDigest&&
    typeof approval.reviewer==='string'&&approval.reviewer.trim(),'EOAPI_RECEIVED_DELIVERY_APPROVAL_CHANGED');
  need(same(identity(edition),review.edition),'EOAPI_CUSTOMER_EDITION_DIFFERS_FROM_APPROVAL');
  const endpoint=normalizeEndpoint(edition.query.endpoint);
  const target=source.source.target??'deployment';
  need(['deployment','upstream'].includes(target)&&endpoint===source.source.endpoint&&
    endpoint===normalizeEndpoint(target==='upstream'?policy.policy.upstream.url:policy.policy.deployment.publicUrl)&&
    hash(edition.catalog)===source.source.catalogSha256,'EOAPI_RECEIVED_CATALOG_CHANGED');
  for(const collection of edition.collections) {
    const original=source.source.collections.find(item=>item.id===collection.id);
    need(original&&original.sha256===hash(collection),'EOAPI_RECEIVED_COLLECTION_CHANGED');
  }
  const received=new Map(members.map(file=>[file.path,file]));
  need(review.edition.assets.length>0,'EOAPI_CUSTOMER_SELECTED_FILES_REQUIRED');
  for(const asset of review.edition.assets) {
    const file=received.get(asset.path);
    need(file&&['path','bytes','sha256','mime'].every(key=>file[key]===asset[key]),'EOAPI_CUSTOMER_SELECTED_FILE_MISSING');
  }
  return policy;
}
function operatorGuide(context,portable) {
  const {source,review,approval}=context;
  const target=source.source.target==='upstream'?'upstream catalog':'customer deployment';
  return '# Customer imagery delivery\n\n'+
    'Open scene-explorer.html for the retained scenes, their footprints, source rights and selected files. '+
    'Use stac-catalog/catalog.json in a STAC-aware tool, or scene-footprints.geojson in a GIS application. '+
    'The source observations in this delivery belong to the reviewed '+target+'.\n\n'+
    '## Receiving record\n\n'+
    '- Original captured edition: '+review.edition.captureId+'\n'+
    '- Original customer edition: '+review.edition.id+'\n'+
    '- Scene count: '+String(portable.summary?.scenes??portable.summary?.items??'see the original scene export')+'\n'+
    '- Selected source files: '+review.edition.assets.length+'\n'+
    '- Source endpoint: '+source.source.endpoint+'\n'+
    '- Source review: '+source.id+'\n'+
    '- Policy approval: '+source.approvalId+'\n'+
    '- Policy package digest: '+source.policyPackageDigest+'\n'+
    '- Delivery approval: '+approval.id+'\n'+
    '- Delivery reviewer: '+approval.reviewer+'\n\n'+
    '## Reopen and operate\n\n'+
    'The original manifest.json and scene-export.json describe the acquired source and GIS files. '+
    'eoapi-delivery.json binds the saved source review, policy package and delivery approval to that original edition. '+
    'Run the installed STAC command eoapi-delivery-open with --directory pointing to this folder to verify and reopen it offline.\n\n'+
    'The approved Auth Proxy configuration is in eoapi/policy. Its OPERATOR.md describes the authored deployment, '+
    'identity, ordered routes, collection rights and settings to apply or clear. Configure credentials through the '+
    'operator host and its existing OAuth connection owner. Then use the operator commissioning view for the reviewed '+
    'deployment-access cases before making the customer deployment available.\n\n'+
    'Keep the exact source file and collection license information together when sharing the selected imagery. '+
    'A new analyst selection or policy change receives a new review and delivery approval; the saved edition can always be reopened as received.\n';
}

/** Accept only a complete original customer delivery; the exact approved selected
 * files must have been received. The original GIS export remains byte-identical. */
export async function exportEoapiDelivery({onboarding,deliveryApprovalId,delivery,directory,signal,progress}={}) {
  need(onboarding&&typeof onboarding.deliveryContext==='function','EOAPI_ONBOARDING_OWNER_REQUIRED');
  need(delivery instanceof StacDelivery,'EOAPI_ORIGINAL_CUSTOMER_DELIVERY_REQUIRED');
  const context=await onboarding.deliveryContext({deliveryApprovalId});
  const policy=checkContext(context,delivery.edition,delivery.members());
  directory=resolve(directory);
  const portable=await exportPortableStacDelivery(delivery,directory,{signal,progress});
  const small={
    'eoapi/source-review.json':jsonBytes(context.source),
    'eoapi/delivery-review.json':jsonBytes(context.review),
    'eoapi/delivery-approval.json':jsonBytes(context.approval),
    'eoapi/policy/package.json':jsonBytes(context.source.policyPackage),
    'eoapi/OPERATOR.md':Buffer.from(operatorGuide(context,portable))
  };
  for(const file of context.source.policyPackage.files)small['eoapi/policy/'+file.path]=Buffer.from(file.text);
  const records=[];
  for(const [path,bytes]of Object.entries(small).sort(([a],[b])=>a.localeCompare(b))) {
    need(!signal?.aborted,'EOAPI_DELIVERY_CANCELLED');
    await stacRetain(join(directory,path),bytes);
    records.push({path,bytes:bytes.length,sha256:sha256(bytes),mime:path.endsWith('.json')?'application/json':
      path.endsWith('.md')?'text/markdown':'text/plain'});
  }
  const core={schema:SCHEMA,editionId:delivery.edition.id,editionDigest:delivery.edition.digest,
    captureId:delivery.edition.capture.id,sourceReviewId:context.source.id,sourceReviewSha256:context.source.sha256,
    policyApprovalId:policy.approval.id,policyDigest:policy.compilation.digest,policyPackageDigest:policy.digest,
    deliveryApprovalId:context.approval.id,deliveryReviewSha256:context.review.sha256,
    sourceDeliverySha256:delivery.manifest.bundleSha256,portableManifestSha256:portable.manifestFile.sha256,
    sourceTarget:context.source.source.target??'deployment',files:records};
  const manifest={...core,sha256:hash(core)},bytes=jsonBytes(manifest);
  await stacRetain(join(directory,MANIFEST),bytes);
  const receipt={directory,sha256:sha256(bytes),manifestDigest:manifest.sha256,bytes:bytes.length,
    editionId:manifest.editionId,editionDigest:manifest.editionDigest,deliveryApprovalId,
    policyApprovalId:manifest.policyApprovalId,policyPackageDigest:manifest.policyPackageDigest,
    sourceDeliverySha256:manifest.sourceDeliverySha256,selectedFiles:context.review.edition.assets.length,
    sourceTarget:manifest.sourceTarget};
  await onboarding.recordDelivery(receipt);
  return receipt;
}

/** All receiving reads go through the original verified files. No Buyer,
 * credentials, source provider or purchase is needed to reopen this directory. */
export async function openEoapiDelivery(directory,{expectedManifestSha256,signal,progress}={}) {
  directory=resolve(directory);
  need(expectedManifestSha256===undefined||HASH.test(expectedManifestSha256),'EOAPI_DELIVERY_EXPECTED_HASH_INVALID');
  const raw=await readBytes(join(directory,MANIFEST),32*1024*1024),manifest=JSON.parse(raw.toString('utf8'));
  if(expectedManifestSha256!==undefined)need(sha256(raw)===expectedManifestSha256,'EOAPI_DELIVERY_MANIFEST_CHANGED');
  const {sha256:digest,...core}=manifest;
  need(manifest.schema===SCHEMA&&HASH.test(digest??'')&&hash(core)===digest&&Array.isArray(manifest.files),
    'EOAPI_DELIVERY_MANIFEST_INVALID');
  const files=new Map();
  for(const record of manifest.files) {
    need(fixed.includes(record.path)||/^eoapi\/policy\/[^/]+$/.test(record.path),'EOAPI_DELIVERY_FILE_UNEXPECTED');
    need(!files.has(record.path),'EOAPI_DELIVERY_FILE_DUPLICATE');
    const file=new StacFile(directory,record);await file.verify({signal});files.set(record.path,file);
  }
  need(fixed.every(path=>files.has(path)),'EOAPI_DELIVERY_FILE_MISSING');
  const read=async path=>files.get(path).json({limit:16*1024*1024,signal});
  const context={source:await read('eoapi/source-review.json'),review:await read('eoapi/delivery-review.json'),
    approval:await read('eoapi/delivery-approval.json')};
  const portable=await openPortableStacDelivery(directory,{expectedManifestSha256:manifest.portableManifestSha256,signal,progress});
  const policy=checkContext(context,portable.delivery.edition,portable.delivery.members());
  need(same(await read('eoapi/policy/package.json'),context.source.policyPackage),'EOAPI_RECEIVED_POLICY_PACKAGE_CHANGED');
  const expected=new Set([...fixed,...context.source.policyPackage.files.map(file=>'eoapi/policy/'+file.path)]);
  need(expected.size===files.size&&[...expected].every(path=>files.has(path)),'EOAPI_DELIVERY_FILE_SET_CHANGED');
  for(const file of context.source.policyPackage.files) {
    const record=files.get('eoapi/policy/'+file.path).record;
    need(record.bytes===file.bytes&&record.sha256===file.sha256,'EOAPI_RECEIVED_POLICY_FILE_CHANGED');
  }
  need(manifest.editionId===portable.delivery.edition.id&&manifest.editionDigest===portable.delivery.edition.digest&&
    manifest.captureId===portable.delivery.edition.capture.id&&manifest.sourceDeliverySha256===portable.delivery.manifest.bundleSha256&&
    manifest.sourceReviewId===context.source.id&&manifest.sourceReviewSha256===context.source.sha256&&
    manifest.policyApprovalId===policy.approval.id&&manifest.policyDigest===policy.compilation.digest&&
    manifest.policyPackageDigest===policy.digest&&manifest.deliveryApprovalId===context.approval.id&&
    manifest.deliveryReviewSha256===context.review.sha256&&manifest.sourceTarget===(context.source.source.target??'deployment'),
    'EOAPI_DELIVERY_APPROVAL_BINDING_CHANGED');
  return Object.freeze({directory,manifest:copy(manifest),manifestFile:{path:join(directory,MANIFEST),bytes:raw.length,sha256:sha256(raw)},
    context:copy(context),policy:copy(policy),portable,delivery:portable.delivery,
    members:()=>manifest.files.map(copy),
    file(path){need(files.has(path),'EOAPI_DELIVERY_FILE_NOT_FOUND');return files.get(path);},
    async importPolicy(workspace) {
      need(workspace&&typeof workspace.importPackage==='function','EOAPI_RECEIVING_POLICY_WORKSPACE_REQUIRED');
      return workspace.importPackage({package:context.source.policyPackage});
    }
  });
}
