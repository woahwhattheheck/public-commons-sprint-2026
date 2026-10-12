// MIT. Original authenticated workspace routes for reusable policy editions and packages.
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectOpenApi, prepareMerchant, readPackage, savePackage, packageName, privateParent, merchantPackageCommand } from './model.mjs';
import { openOperationPolicyStore } from './operation-policy-store.mjs';
import { normalizeOperationPolicy, operationPolicyCanonical, operationPolicyText } from './operation-policy-model.mjs';
import { prepareOperationPolicyApplication, operationPolicyReview, operationPolicySha256 } from './operation-policy-record.mjs';

const PREFIX = '/api/operation-policies/';
const hash = /^[a-f0-9]{64}$/;
const own = (value,key) => Object.hasOwn(value,key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const reviewFields = ['specText','plan','worksheet','policy','policyDocument','targets','overrides','operationPlans','capturedSource'];
const fail = (message,code='OPENAPI_OPERATION_POLICY_INVALID',status=400) => {
  throw Object.assign(new TypeError(message),{code,status});
};
function exact(value,allowed,required=[]) {
  if (!plain(value) || Object.keys(value).some(key=>!allowed.includes(key)) ||
      required.some(key=>!own(value,key))) fail('Use the complete declared operation policy request fields.');
}
function numberParameter(url,name,fallback) {
  const text = url.searchParams.get(name);
  if (text === null) return fallback;
  if (!/^(0|[1-9][0-9]{0,9})$/.test(text)) fail('Use a non-negative whole number for ' + name + '.');
  return Number(text);
}
export async function createOperationPolicyRoutes({parent,validatePlan,har}) {
  parent=await privateParent(parent);
  const library = await openOperationPolicyStore({parent});
  function validateRequest(body,{packageSave=false}={}) {
    exact(body,packageSave ? [...reviewFields,'name','expectedReviewSha256'] : reviewFields,
      ['specText','plan','targets',...(packageSave ? ['name','expectedReviewSha256'] : [])]);
    if (own(body,'policy') === own(body,'policyDocument'))
      fail('Select one exact saved policy edition or one complete portable policy document.');
    if (own(body,'policy')) {
      exact(body.policy,['id','sha256'],['id','sha256']);
      if (!hash.test(body.policy.sha256 ?? '')) fail('Select the exact saved policy edition SHA-256.');
    }
  }
  async function selectedPolicy(body,retained) {
    if (!own(body,'policy')) return normalizeOperationPolicy(body.policyDocument);
    if (retained !== undefined) {
      const policy=normalizeOperationPolicy(retained);
      if (policy.id!==body.policy.id || operationPolicySha256(operationPolicyText(policy))!==body.policy.sha256)
        fail('This saved package belongs to a different selected policy edition.','OPENAPI_OPERATION_POLICY_PACKAGE_CONFLICT',409);
      return policy;
    }
    return (await library.load({id:body.policy.id,sha256:body.policy.sha256,historyLimit:1})).policy;
  }
  async function prepare(body,{packageSave=false}={}) {
    validateRequest(body,{packageSave});
    const policy=await selectedPolicy(body);
    const inspection = inspectOpenApi(body.specText);
    const prepared = prepareOperationPolicyApplication({
      specText:body.specText,plan:body.plan,worksheet:body.worksheet,policy,
      targets:body.targets,overrides:body.overrides,operationPlans:body.operationPlans,
      capturedSource:body.capturedSource,inspection
    });
    if (body.capturedSource !== undefined) {
      if (typeof har !== 'function') fail('Open this captured source in its original HAR workspace.');
      await (await har()).app.checkSource(body.capturedSource,body.specText,prepared.plan);
    }
    if (typeof validatePlan === 'function') await validatePlan(body.specText,prepared.plan);
    return operationPolicyReview(prepared,prepareMerchant(body.specText,prepared.plan).preview);
  }
  /** Reopen committed exact work before consulting mutable host credentials or catalogues. */
  async function reopenPackage(body,name,{required=false}={}) {
    try { await lstat(join(parent,name)); }
    catch (error) {
      if (error.code==='ENOENT' && !required) return null;
      throw error;
    }
    let original;
    try { original=await readPackage(parent,name); }
    catch (cause) {
      throw Object.assign(new Error('This package name contains incomplete or changed original files. Choose another name.',{cause}),
        {code:'OPENAPI_OPERATION_POLICY_PACKAGE_CONFLICT',status:409});
    }
    if (original.specText!==body.specText || !original.operationPolicy ||
        original.operationPolicy.review.sha256!==body.expectedReviewSha256)
      fail('This name belongs to another original source or policy review. Choose a new package name.',
        'OPENAPI_OPERATION_POLICY_PACKAGE_CONFLICT',409);
    const policy=await selectedPolicy(body,original.operationPolicy.policy);
    const prepared=prepareOperationPolicyApplication({
      specText:body.specText,plan:body.plan,worksheet:body.worksheet,policy,
      targets:body.targets,overrides:body.overrides,operationPlans:body.operationPlans,
      capturedSource:body.capturedSource,inspection:inspectOpenApi(body.specText)
    });
    const reviewed=operationPolicyReview(prepared,prepareMerchant(body.specText,prepared.plan).preview);
    if (reviewed.review.sha256!==body.expectedReviewSha256 ||
        operationPolicyCanonical(original.plan)!==operationPolicyCanonical(reviewed.plan) ||
        operationPolicyCanonical(original.operationPolicy)!==operationPolicyCanonical(reviewed.operationPolicy))
      fail('This name belongs to different retained route choices or policy overrides. Choose a new package name.',
        'OPENAPI_OPERATION_POLICY_PACKAGE_CONFLICT',409);
    return {state:'REOPENED',name:original.name,folder:original.folder,
      command:merchantPackageCommand(original.folder,original.plan),preview:reviewed.preview,
      review:reviewed.review,operationPolicy:original.operationPolicy};
  }
  async function saveReviewedPackage(body) {
    validateRequest(body,{packageSave:true});
    const name=packageName(body.name);
    if (!hash.test(body.expectedReviewSha256 ?? '')) fail('Review this complete policy application before saving its package.');
    const reopened=await reopenPackage(body,name);
    if (reopened) return reopened;
    const reviewed=await prepare(body,{packageSave:true});
    if (reviewed.review.sha256!==body.expectedReviewSha256)
      fail('The policy, source, plan or route choices changed after review. Review the current candidate.',
        'OPENAPI_OPERATION_POLICY_REVIEW_CHANGED',409);
    let saved;
    try {
      saved=body.capturedSource!==undefined
        ? await (await har()).app.saveMerchant({
            capturedSource:body.capturedSource,specText:body.specText,plan:reviewed.plan,name,
            operationPolicy:reviewed.operationPolicy
          })
        : await savePackage({
            parent,name,specText:body.specText,plan:reviewed.plan,operationPolicy:reviewed.operationPolicy
          });
    } catch (error) {
      if (error.code!=='EEXIST') throw error;
      return reopenPackage(body,name,{required:true});
    }
    return {state:'SAVED',name:saved.name,folder:saved.folder,command:saved.command,preview:saved.preview,
      review:reviewed.review,operationPolicy:reviewed.operationPolicy};
  }
  return {
    review:body=>prepare(body),
    async get(pathname,url,send) {
      if (pathname === PREFIX+'list') return send(200,await library.list({
        offset:numberParameter(url,'offset',0),limit:numberParameter(url,'limit',50)
      }));
      const selected = {id:url.searchParams.get('id'),
        ...(url.searchParams.has('sha256') ? {sha256:url.searchParams.get('sha256')} : {})};
      if (pathname === PREFIX+'load') return send(200,await library.load({
        ...selected,historyOffset:numberParameter(url,'historyOffset',0),
        historyLimit:numberParameter(url,'historyLimit',25)
      }));
      if (pathname === PREFIX+'export') return send(200,await library.exportPolicy(selected));
      return send(404,{error:'Choose an original operation policy route.'});
    },
    async post(pathname,body,send) {
      if (pathname === PREFIX+'save') {
        exact(body,['policy','expectedHeadSha256'],['policy','expectedHeadSha256']);
        const value = await library.save(body);
        return send(value.state === 'REOPENED' ? 200 : 201,value);
      }
      if (pathname === PREFIX+'package') {
        const value = await saveReviewedPackage(body);
        return send(value.state === 'REOPENED' ? 200 : 201,value);
      }
      return send(404,{error:'Choose an original operation policy route.'});
    }
  };
}
