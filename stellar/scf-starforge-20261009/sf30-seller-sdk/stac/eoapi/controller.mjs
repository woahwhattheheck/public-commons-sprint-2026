// MIT. Routes mounted inside the original authenticated STAC operator session.
import {StacDelivery} from '../customer.mjs';
import {exportEoapiDelivery,openEoapiDelivery} from './delivery.mjs';

const fault=(code,message)=>Object.assign(new Error(message),{code,status:400});
const missing=()=>{throw fault('EOAPI_ROUTE_NOT_FOUND','This customer onboarding action was not found.');};
const required=(value,label)=>{if(typeof value!=='string'||!value.trim())throw fault('EOAPI_INPUT_REQUIRED',label+' is required.');return value;};
export function createEoapiController({runtime,commissioning=runtime?.commissioningController}={}) {
  if(!runtime?.onboarding||!runtime?.policies)throw new TypeError('The original eoAPI runtime is required.');
  const {policies,onboarding}=runtime;
  const actions=new Map([
    ['/policy/draft',body=>policies.saveDraft(body)],
    ['/policy/review',body=>policies.review(body)],
    ['/policy/approve',body=>policies.approve(body)],
    ['/policy/import',body=>policies.importPackage(body)],
    ['/policy/export',body=>policies.exportPackage(body)],
    ['/source/discover',body=>onboarding.discover(body)],
    ['/source/review',body=>onboarding.reviewSource(body)],
    ['/editions/bind',body=>onboarding.bindEdition(body)],
    ['/editions/capture',body=>onboarding.capture(body)],
    ['/assets/acquire',body=>onboarding.acquireSelected(body)],
    ['/delivery/review',body=>onboarding.prepareDelivery(body)],
    ['/delivery/approve',body=>onboarding.approveDelivery(body)],
    ['/merchant/stage',body=>onboarding.stageMerchant(body)],
    ['/delivery/export',async(body,signal)=>{
      const delivery=await StacDelivery.open(required(body.customerDirectory,'Original customer delivery folder'),{signal});
      return exportEoapiDelivery({onboarding,deliveryApprovalId:body.deliveryApprovalId,delivery,
        directory:required(body.directory,'Delivery folder'),signal});
    }],
    ['/delivery/open',async(body,signal)=>{
      const value=await openEoapiDelivery(required(body.directory,'Delivery folder'),{signal,
        expectedManifestSha256:body.expectedManifestSha256});
      if(body.importPolicy===true)await value.importPolicy(policies);
      return {directory:value.directory,manifest:value.manifest,manifestFile:value.manifestFile,
        summary:value.portable.manifest.summary,members:value.delivery.members(),approval:value.context.approval};
    }]
  ]);
  return Object.freeze({
    async state() {
      return {policies:await policies.getState(),onboarding:await onboarding.getState(),source:runtime.source.snapshot(),
        commissioning:Boolean(commissioning)};
    },
    async dispatch({method='GET',path,body={},signal}={}) {
      if(path.startsWith('/commissioning/')&&commissioning)
        return commissioning.dispatch({method,path:path.slice('/commissioning'.length),body,signal});
      if(method==='GET'&&path==='/state')return this.state();
      if(method==='GET'&&path.startsWith('/operations/'))return onboarding.getOperation(decodeURIComponent(path.slice('/operations/'.length)));
      if(method==='GET'&&path.startsWith('/source/reviews/'))
        return onboarding.sourceReview(decodeURIComponent(path.slice('/source/reviews/'.length)));
      if(method==='GET'&&path.startsWith('/delivery/reviews/'))
        return onboarding.deliveryReview(decodeURIComponent(path.slice('/delivery/reviews/'.length)));
      if(method!=='POST'||!actions.has(path))return missing();
      if(signal?.aborted)throw fault('EOAPI_REQUEST_CANCELLED','This customer operation was cancelled.');
      return actions.get(path)(body,signal);
    }
  });
}
