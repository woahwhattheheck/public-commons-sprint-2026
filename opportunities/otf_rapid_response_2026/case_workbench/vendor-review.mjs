/* MIT. Original proposal receiving through the maintained vendor compiler. */
import {check,render} from "../vendor_submission_20261011/vendor-core.mjs";
import {documentFromBytes,decodeJSON,LIMITS} from "./model.mjs";
export async function reviewVendorOriginal(name,bytes){
 if(bytes.length>LIMITS.document_bytes)throw new Error("Vendor original exceeds 24 MiB");
 const original=decodeJSON(bytes);if(!original||typeof original!=="object"||Array.isArray(original))throw new Error("Vendor input must be an object");
 const source=await documentFromBytes(name,"application/json",bytes),quality=check(original);
 const cents=v=>Number.isSafeInteger(v)&&v>=0?v:null;
 const proposal={schema:"commons.otf-vendor-proposal-review.v1",source_sha256:source.sha256,provider:typeof original.applicant?.name==="string"?original.applicant.name:"",services:Array.isArray(original.services)?original.services.map(s=>({category:s.category??"",offering:s.offering??"",method:s.method??""})):[],roles:Array.isArray(original.laborRates)?original.laborRates.map((r,n)=>({id:typeof r.id==="string"?r.id:"role-"+(n+1),title:r.title??"",proposed_loaded_hourly_cents:cents(r.loadedHourlyCents),proposed_commercial_hourly_cents:cents(r.commercialHourlyCents)})):[],budget:{requested_contract_ceiling_cents:cents(original.budget?.requestedContractCeilingCents),other_direct_costs_category:original.budget?.otherDirectCostsCategory??"",other_direct_costs_cents:cents(original.budget?.otherDirectCostsCents)},declared_capacity:original.qualifications?.capacity??"",declared_response:original.qualifications?.response??"",quality};
 return {source,proposal,markdown:render(original,quality,{audience:"internal"})};
}
