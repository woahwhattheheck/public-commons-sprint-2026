// MIT. Reviewed Prescient S3 access over the original SDK receiver.
import {normalizePrescientProfile,configurationDigest,PRESCIENT_SDK} from './configuration.mjs';
import {publicPrescientError} from './source-auth.mjs';
const fail=code=>Object.assign(new Error(code),{code});
const need=(value,code)=>{if(!value)throw fail(code);};
const clone=value=>structuredClone(value);
function s3Candidate(href){
  let url;try{url=new URL(href);}catch{return false;}
  return url.protocol==='s3:'||url.protocol==='https:'&&/\.s3\.[a-z]{2}(?:-[a-z]+)+-\d+\.amazonaws\.com$/u.test(url.hostname);
}
/** Null retains the ordinary native HTTPS route. Only an explicit binding selects SDK receiving. */
export function createPrescientAssetAccess({profile,getRuntime,onProgress}={}){
  profile=normalizePrescientProfile(profile);const profileSha256=configurationDigest(profile);
  need(typeof getRuntime==='function','PRESCIENT_RUNTIME_GETTER_REQUIRED');
  async function reviewAsset({descriptor,workspaceId,signal}={}){
    need(descriptor&&typeof descriptor.href==='string','PRESCIENT_ASSET_DESCRIPTOR_REQUIRED');
    if(!profile.collections.includes(descriptor.collection))
      return {eligible:false,eligibilityReason:'PRESCIENT_COLLECTION_NOT_APPROVED',access:null};
    if(!s3Candidate(descriptor.href))return null;
    need(typeof workspaceId==='string'&&workspaceId,'PRESCIENT_WORKSPACE_ID_REQUIRED');
    try{
      const runtime=await getRuntime({signal});
      const reviewed=await runtime.reviewS3({descriptor,signal});
      need(reviewed?.eligible===true&&reviewed.source?.originalHref===descriptor.href,'PRESCIENT_S3_REVIEW_INVALID');
      const access={schema:'starforge.prescient-asset-access/v1',profileSha256,workspaceId,
        sdkCommit:PRESCIENT_SDK.commit,source:clone(reviewed.source)};
      return {eligible:true,eligibilityReason:'PRESCIENT_APPROVED_S3',access};
    }catch(error){
      const safe=publicPrescientError(error);
      if(['PRESCIENT_S3_OBJECT_NOT_APPROVED','PRESCIENT_S3_SCOPE_AMBIGUOUS',
        'PRESCIENT_REQUESTER_PAYS_APPROVAL_REQUIRED','PRESCIENT_STORAGE_SCHEME_UNRESOLVED'].includes(safe.code))
        return {eligible:false,eligibilityReason:safe.code,access:null};
      throw Object.assign(fail(safe.code),safe.details?{details:safe.details}:{});
    }
  }
  async function downloadAsset({descriptor,directory,maxBytes,selection,signal}={}){
    const access=descriptor?.access;
    need(access?.schema==='starforge.prescient-asset-access/v1'&&access.profileSha256===profileSha256&&
      access.sdkCommit===PRESCIENT_SDK.commit,'PRESCIENT_ASSET_PROFILE_CHANGED');
    need(selection?.workspaceId===access.workspaceId&&typeof selection.reviewId==='string'&&
      selection.reviewId===descriptor.id&&selection.itemDigest===descriptor.itemDigest&&
      typeof selection.operationId==='string'&&selection.operationId,'PRESCIENT_ASSET_SELECTION_CHANGED');
    need(Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=profile.maxAssetBytes&&
      maxBytes===descriptor.maxBytes,'PRESCIENT_ASSET_BYTE_LIMIT_CHANGED');
    const checked=await reviewAsset({descriptor,workspaceId:selection.workspaceId,signal});
    need(checked?.eligible&&configurationDigest(checked.access)===configurationDigest(access),
      'PRESCIENT_ASSET_ACCESS_CHANGED');
    const runtime=await getRuntime({signal});
    try{return await runtime.downloadS3({descriptor,directory,maxBytes,selection,signal,onProgress});}
    catch(error){const safe=publicPrescientError(error);throw Object.assign(fail(safe.code),safe.details?{details:safe.details}:{});}
  }
  return Object.freeze({reviewAsset,downloadAsset});
}
