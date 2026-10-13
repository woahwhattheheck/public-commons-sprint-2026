import {renderCustomerDocumentViewer} from "./customer-document-viewer.mjs";
export function latin1Archive(bytes){
 if(!(bytes instanceof Uint8Array))throw Error("Select the complete original ZIP bytes.");
 let output="";for(let at=0;at<bytes.length;at+=8192)output+=String.fromCharCode(...bytes.subarray(at,at+8192));return output;
}
export function renderCompactCustomerDocumentViewer(options,format={}){
 const html=renderCustomerDocumentViewer(options,format),marker="const b=unbase(p.payload);";
 if(html.split(marker).length!==2)throw Error("The original package decoder changed; preserve the complete renderer before integration.");
 return html.replace(marker,()=>'const b=p.payload_encoding==="latin1-json"?Uint8Array.from(p.payload,c=>{const n=c.charCodeAt(0);if(n>255)throw Error("Invalid original archive byte.");return n;}):unbase(p.payload);');
}
