// MIT. Saved scenario operations through the original authenticated merchant MCP.
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const fail = (code,message) => Object.assign(new Error(message),{code:'PRICING_CLIENT_'+code});
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const pricingClientOperations = Object.freeze({
  status:'merchant_pricing_status',open:'merchant_pricing_open',close:'merchant_pricing_close',
  capture:'merchant_pricing_source','review-preview':'merchant_pricing_preview',
  'review-save':'merchant_pricing_save','review-load':'merchant_pricing_load',
  source:'merchant_pricing_planning_source',preview:'merchant_pricing_planning_preview',
  save:'merchant_pricing_planning_save',list:'merchant_pricing_planning_list',
  load:'merchant_pricing_planning_load',selection:'merchant_pricing_planning_selection',
  apply:'merchant_pricing_planning_apply',manifest:'merchant_pricing_manifest'
});

/** Arguments contain the original request IDs; the client never creates a replacement. */
export async function callMerchantPricing({operation,args={},...connection} = {}) {
  if (!Object.hasOwn(pricingClientOperations,operation) || !plain(args))
    throw fail('ARGUMENTS','Choose a declared pricing operation and its exact input object.');
  if (operation !== 'status' && !ALIAS.test(args.workspace ?? ''))
    throw fail('ARGUMENTS','Supply the existing host-declared pricing workspace alias.');
  const client=await openMerchantFileClient({...connection,errorPrefix:'PRICING',clientName:'starforge-merchant-pricing'});
  if (!['status','open','close'].includes(operation))
    await client.call('merchant_pricing_open',{workspace:args.workspace});
  return client.call(pricingClientOperations[operation],args);
}

function parseManifest(bytes,planId) {
  let value;
  try { value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw fail('MANIFEST_INVALID','The original scenario manifest is not UTF-8 JSON.'); }
  if (value?.schema !== 'stellar-forge.merchant-scenario-files.v1' || value.planId !== planId ||
      !UUID.test(value.version ?? '') || !HASH.test(value.reviewSha256 ?? '') || !plain(value.files))
    throw fail('MANIFEST_INVALID','Use the complete manifest for the selected original scenario plan.');
  const files=Object.entries(value.files).map(([name,file]) => {
    if (!['plan.json','comparison.csv'].includes(name) && !/^terms-[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/.test(name) ||
        !plain(file) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_BYTES || !HASH.test(file.sha256 ?? ''))
      throw fail('MANIFEST_INVALID','An original scenario file has an unsupported name, byte count or SHA-256.');
    return {name,bytes:file.bytes,sha256:file.sha256};
  });
  if (files.length < 2 || files.length > 14 || !Object.hasOwn(value.files,'plan.json') || !Object.hasOwn(value.files,'comparison.csv'))
    throw fail('MANIFEST_INVALID','The scenario manifest must include its complete plan, comparison and up to twelve terms files.');
  return {...value,exportId:planId,files};
}

function downloader(workspace) {
  if (!ALIAS.test(workspace ?? '')) throw fail('ARGUMENTS','Supply the existing pricing workspace alias.');
  return createRetainedDownload({manifestName:'manifest.json',parseManifest,maximumBytes:MAX_BYTES,
    stateSchema:'stellar-forge.scenario-download-state.v1',resultSchema:'stellar-forge.scenario-download.v1',
    toolPrefix:'merchant_pricing',errorPrefix:'PRICING',clientName:'starforge-merchant-pricing',
    describe:value=>({planId:value.planId,version:value.version,reviewSha256:value.reviewSha256}),
    connect:async options => {
      const original=await openMerchantFileClient(options);
      await original.call('merchant_pricing_open',{workspace});
      return {endpoint:original.endpoint,async call(name,args,requestOptions) {
        const {exportId,...selectors}=args;
        const selected=name.endsWith('_file_release') ? {workspace,readId:selectors.readId}
          : {workspace,kind:'scenario',id:exportId,...selectors};
        const result=await original.call(name,selected,requestOptions);
        if (result.workspace !== workspace || result.id !== undefined && result.id !== exportId)
          throw fail('IDENTITY_CHANGED','The MCP reply belongs to a different pricing workspace or plan.');
        return {...result,exportId,...(name.endsWith('_manifest') ? {state:'MANIFEST_RETAINED'} : {})};
      }};
    }});
}

/** The original retained downloader owns chunk hashes, private files and recovery. */
export function downloadMerchantScenario({workspace,planId,...options} = {}) {
  if (!UUID.test(planId ?? '')) throw fail('ARGUMENTS','Supply the exact retained planId.');
  return downloader(workspace).download({...options,exportId:planId});
}
export function inspectMerchantScenario({workspace,planId,...options} = {}) {
  if (!UUID.test(planId ?? '')) throw fail('ARGUMENTS','Supply the exact retained planId.');
  return downloader(workspace).inspect({...options,exportId:planId});
}
