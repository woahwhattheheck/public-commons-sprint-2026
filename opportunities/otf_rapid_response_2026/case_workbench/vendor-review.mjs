/* MIT. Original proposal receiving through the maintained vendor compiler. */
import {check,render} from "../vendor_submission_20261011/vendor-core.mjs";
import {documentFromBytes,decodeJSON,LIMITS,readLedger,applyOperation,canonical,sourceBytes} from "./model.mjs";
export async function reviewVendorOriginal(name,bytes){
 if(bytes.length>LIMITS.document_bytes)throw new Error("Vendor original exceeds 24 MiB");
 const original=decodeJSON(bytes);if(!original||typeof original!=="object"||Array.isArray(original))throw new Error("Vendor input must be an object");
 const source=await documentFromBytes(name,"application/json",bytes),quality=check(original);
 const cents=v=>Number.isSafeInteger(v)&&v>=0?v:null;
 const proposal={schema:"commons.otf-vendor-proposal-review.v1",source_sha256:source.sha256,provider:typeof original.applicant?.name==="string"?original.applicant.name:"",services:Array.isArray(original.services)?original.services.map(s=>({category:s.category??"",offering:s.offering??"",method:s.method??""})):[],roles:Array.isArray(original.laborRates)?original.laborRates.map((r,n)=>({id:typeof r.id==="string"?r.id:"role-"+(n+1),title:r.title??"",proposed_loaded_hourly_cents:cents(r.loadedHourlyCents),proposed_commercial_hourly_cents:cents(r.commercialHourlyCents)})):[],budget:{requested_contract_ceiling_cents:cents(original.budget?.requestedContractCeilingCents),other_direct_costs_category:original.budget?.otherDirectCostsCategory??"",other_direct_costs_cents:cents(original.budget?.otherDirectCostsCents)},declared_capacity:original.qualifications?.capacity??"",declared_response:original.qualifications?.response??"",quality};
 return {source,proposal,markdown:render(original,quality,{audience:"internal"})};
}

export async function retainVendorOriginal(input,review,at){
 const opened=await readLedger(input),document=review.source,id="proposal-source-"+document.id.slice(0,16),sourceInput={source_ids:[document.id],note:"Original vendor proposal retained for review. Actual awarded terms are recorded separately."},prior=opened.ledger.operations.find(event=>event.id===id);
 if(prior&&(prior.type!=="source.record"||canonical(prior.input)!==canonical(sourceInput)))throw new Error("Proposal source ID belongs to a different original operation");
 const request={id,at:prior?prior.at:at,type:"source.record",input:sourceInput,documents:[document]};
 return applyOperation(opened.ledger,request);
}

/** Retain the complete exact prepared edition through the original source operation. */
export async function retainVendorPrepared(input,prepared,originalReview,at){
 const opened=await readLedger(input),selected=new Map(),members=[],names=new Set();
 if(!prepared||!Array.isArray(prepared.files)||prepared.files.length<3||prepared.files.length>12)throw new Error("Complete prepared proposal files are required");
 async function retain(name,media_type,bytes){
  const supplied=await documentFromBytes(name,media_type,bytes),existing=opened.ledger.documents.find(d=>d.id===supplied.id)??selected.get(supplied.id);
  const document=existing??supplied;selected.set(document.id,document);
  return {name,media_type,bytes:supplied.bytes,sha256:supplied.sha256,document_id:document.id,retained_name:document.name,retained_media_type:document.media_type};
 }
 for(const file of prepared.files){if(names.has(file.name))throw new Error("Prepared proposal repeats a file name");names.add(file.name);members.push(await retain(file.name,file.media_type,file.bytes));}
 for(const name of ["vendor-input.json","proposal-review.md","readiness.json"])if(!names.has(name))throw new Error("Prepared proposal omits "+name);
 let original=null;if(originalReview){const supplied=originalReview.source;if(!supplied)throw new Error("Imported original is missing");const bytes=sourceBytes(supplied),validated=await documentFromBytes(supplied.name,supplied.media_type,bytes);if(canonical(validated)!==canonical(supplied))throw new Error("Imported original differs from its complete source");original=await retain(supplied.name,supplied.media_type,bytes);}
 const manifest={schema:"commons.otf-vendor-edition.v1",files:members,imported_original:original},manifestDocument=await documentFromBytes("vendor-edition-manifest.json","application/json",new TextEncoder().encode(JSON.stringify(manifest,null,2)+"\n")),existing=opened.ledger.documents.find(d=>d.id===manifestDocument.id);
 selected.set(manifestDocument.id,existing??manifestDocument);
 const id="proposal-edition-"+manifestDocument.sha256,sourceInput={source_ids:[...selected.keys()],note:"Complete prepared vendor proposal edition. Original file names and each retained source binding are in vendor-edition-manifest.json; actual awarded terms are recorded separately."},prior=opened.ledger.operations.find(event=>event.id===id);
 if(prior&&(prior.type!=="source.record"||canonical(prior.input)!==canonical(sourceInput)))throw new Error("Proposal edition ID belongs to a different original operation");
 const result=await applyOperation(opened.ledger,{id,at:prior?prior.at:at,type:"source.record",input:sourceInput,documents:[...selected.values()]});
 return {...result,edition:manifest,manifest_id:manifestDocument.id};
}
