/* MIT. Bind selected proposal attachments to actual included bytes. */
export const ATTACHMENT_LIMITS=Object.freeze({count:64,fileBytes:16777216,totalBytes:16777216});
const RESERVED=new Set(["vendor-input.json","proposal-review.md","proposal-submission.md","readiness.json","budget-mapping.json","budget_template-rfp-2026.completed.xlsx","vendor-edition-manifest.json","submission-files.json","operation.json","complete.json","otf-vendor-proposal.zip","otf-vendor-submission.zip","originals","__proto__","constructor","prototype"]);
export function attachmentName(reference){
 if(typeof reference!=="string"||!reference.startsWith("attachment:"))return null;
 const name=reference.slice(11);
 if(!name||name!==name.trim()||name.length>200||name==="."||name===".."||/[\/\\\u0000-\u001F\u007F]/.test(name)||RESERVED.has(name.toLowerCase()))throw new Error("Attachment must select a safe, nonreserved filename: "+reference);
 return name;
}
function base64(bytes){let value="";for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);}
function bytesOf(value){
 if(typeof value!=="string"||value.length>Math.ceil(ATTACHMENT_LIMITS.fileBytes/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new Error("Attachment content must be canonical base64 within the file limit");
 const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));if(base64(bytes)!==value)throw new Error("Attachment base64 differs from its canonical encoding");return bytes;
}
export function selectedAttachmentReferences(doc){
 const references=[];
 for(const [collection,originalKey,publicKey] of [["team","cvEvidence","cvPublicEvidence"],["workExamples","evidence","publicEvidence"]]){
  for(const [index,row] of (Array.isArray(doc?.[collection])?doc[collection]:[]).entries()){
   const value=typeof row?.[publicKey]==="string"&&row[publicKey].trim()?row[publicKey].trim():typeof row?.[originalKey]==="string"?row[originalKey].trim():"";
   const name=attachmentName(value);if(name!==null)references.push({path:collection+"["+index+"]."+publicKey,name});
  }
 }
 return references;
}
function decodeSelected(doc){
 const inventory=doc.outwardAttachments??[];
 if(!Array.isArray(inventory)||inventory.length>ATTACHMENT_LIMITS.count)throw new Error("Outward attachment inventory exceeds supported capacity");
 const names=new Map();
 for(const item of inventory){
  if(!item||typeof item!=="object"||Array.isArray(item)||typeof item.name!=="string")throw new Error("Attachment inventory entries must identify a file");
  const name=attachmentName("attachment:"+item.name),key=name.toLowerCase();if(names.has(key))throw new Error("Attachment filenames collide: "+name);names.set(key,item);
 }
 let total=0;const selected=new Map(),references=selectedAttachmentReferences(doc);
 for(const ref of references){
  const item=names.get(ref.name.toLowerCase());if(!item||item.name!==ref.name)throw new Error(ref.path+" selects an absent attachment: "+ref.name);
  if(selected.has(ref.name)){selected.get(ref.name).references.push(ref.path);continue;}
  if(item.approvedForSubmission!==true)throw new Error("Select an explicitly approved outward attachment: "+item.name);
  if(typeof item.mediaType!=="string"||!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(item.mediaType))throw new Error("Attachment media type is invalid: "+item.name);
  if(!Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>ATTACHMENT_LIMITS.fileBytes||typeof item.sha256!=="string"||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error("Attachment length or SHA-256 is invalid: "+item.name);
  const bytes=bytesOf(item.contentBase64);if(bytes.length!==item.bytes)throw new Error("Attachment length does not match original bytes: "+item.name);
  total+=bytes.length;if(total>ATTACHMENT_LIMITS.totalBytes)throw new Error("Selected proposal attachments exceed the full package limit");
  selected.set(item.name,{name:item.name,media_type:item.mediaType,bytes,sha256:item.sha256,references:[ref.path]});
 }
 return [...selected.values()];
}
function finish(files,digests){
 for(let i=0;i<files.length;i++)if(digests[i]!==files[i].sha256)throw new Error("Attachment SHA-256 does not match original bytes: "+files[i].name);
 return {files,manifest:files.map(file=>({name:file.name,mediaType:file.media_type,bytes:file.bytes.length,sha256:file.sha256,references:file.references}))};
}
export function validateVendorAttachments(doc,sha256){
 const files=decodeSelected(doc);return finish(files,files.map(file=>{const value=sha256(file.bytes);if(value&&typeof value.then==="function")throw new Error("Synchronous attachment validation received an asynchronous digest");return value;}));
}
export async function validateVendorAttachmentsAsync(doc,sha256){
 const files=decodeSelected(doc);return finish(files,await Promise.all(files.map(file=>sha256(file.bytes))));
}
export async function createOutwardAttachment(name,mediaType,bytes,sha256){
 attachmentName("attachment:"+name);
 if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>ATTACHMENT_LIMITS.fileBytes)throw new Error("Selected attachment is empty or exceeds 16 MiB");
 if(typeof mediaType!=="string"||!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mediaType))throw new Error("Attachment media type is invalid");
 const hash=await sha256(bytes);if(typeof hash!=="string"||!/^[a-f0-9]{64}$/.test(hash))throw new Error("Attachment digest is invalid");
 return {name,mediaType,bytes:bytes.length,sha256:hash,contentBase64:base64(bytes),approvedForSubmission:false};
}
