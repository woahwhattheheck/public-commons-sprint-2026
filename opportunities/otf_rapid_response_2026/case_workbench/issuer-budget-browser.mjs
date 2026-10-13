/* MIT. Browser runtime for the single maintained issuer workbook transformation. */
import {createAsyncIssuerBudget} from "../vendor_submission_20261011/issuer-budget-core.mjs";
import {ORIGINAL_TEMPLATE_BASE64} from "./issuer-template.mjs";
function originalBytes(){const text=atob(ORIGINAL_TEMPLATE_BASE64);return Uint8Array.from(text,c=>c.charCodeAt(0));}
export async function sha256(bytes){if(!globalThis.crypto?.subtle)throw new Error("This browser does not expose SHA-256 here. Open the standalone desk in a trusted browser context.");const digest=await globalThis.crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");}
async function inflateRaw(bytes,expectedBytes){
 let stream;try{stream=new DecompressionStream("deflate-raw");}catch{throw new Error("This browser does not support raw DEFLATE for the original XLSX. Use a current Chromium browser or the same vendor compiler's Node command.");}
 const reader=new Blob([bytes]).stream().pipeThrough(stream).getReader(),chunks=[];let size=0;
 try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>expectedBytes){await reader.cancel();throw new Error("Workbook expansion exceeds its original member length");}chunks.push(item.value);}}finally{reader.releaseLock();}
 if(size!==expectedBytes)throw new Error("Workbook expansion differs from its original member length");
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
export async function buildVendorBudget(draft){return createAsyncIssuerBudget({sha256,inflateRaw}).buildIssuerBudget(originalBytes(),draft);}
