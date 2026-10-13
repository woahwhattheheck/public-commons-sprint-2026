import {renderCustomerDocumentViewer} from "./customer-document-viewer.mjs";
import {documentPreview} from "./customer-package-panel.mjs";
export function latin1Archive(bytes){
 if(!(bytes instanceof Uint8Array))throw Error("Select the complete original ZIP bytes.");
 let output="";for(let at=0;at<bytes.length;at+=8192)output+=String.fromCharCode(...bytes.subarray(at,at+8192));return output;
}
export function reportOpening(name,source){
 if(!/^report-(?:sample|paid)\/app\.html$/.test(name))return null;
 const marker="\n})(",at=source.indexOf(marker),end=source.lastIndexOf(");</script>");
 if(source.split(marker).length!==2||end<=at)throw Error("The complete report desk opening changed.");
 const values=JSON.parse("["+source.slice(at+marker.length,end)+"]"),workspace=values[0],guide=values[1],seed=workspace?.seed;
 if(values.length!==5||workspace?.version!=="jsonsupport.report-handover.v1"||!Array.isArray(seed?.leads)||!seed.edition_id||typeof guide!=="string")throw Error("Complete report scope or guide missing.");
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const working=name.replace(/app\.html$/,"working.json"),agencies=seed.leads.map(a=>"<li>"+esc(a.document.organization)+"</li>").join("");
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JSON Support report desk</title><style>html{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:20px;font:16px/1.55 system-ui;color:#23282d;background:#fff;overflow-wrap:anywhere}h1{font-size:24px;line-height:1.2}h2{font-size:19px}aside{border:1px solid #bfc5cb;padding:16px;background:#f6f7f8}li{margin:8px 0}code{white-space:normal;overflow-wrap:anywhere}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;min-height:44px;font-weight:600}</style></head><body data-jsonsupport-report-opening="complete"><h1>JSON Support report desk</h1><p>Complete editable report preparation for '+seed.leads.length+' original agency '+(seed.leads.length===1?"profile":"profiles")+'.</p><aside><h2>Open the working desk</h2><ol><li>Download the complete pack and extract the ZIP.</li><li>Open <code>'+esc(name)+'</code> in a browser.</li><li>Choose <strong>Open working file</strong> and receive <code>'+esc(working)+'</code>.</li></ol><p>Review the actual client reporting process, map a local source sample, prepare the exact conversion request, record actual results and save the full editable handover.</p></aside><h2>Included agency research</h2><ul>'+agencies+'</ul><h2>Complete working views</h2><ol><li>Agency context and current reporting process</li><li>Report setup, source records and typed column mapping</li><li>Conversion requests, actual results and returned-data comparison</li><li>Named client handovers and complete working-file receiving</li><li>Source-linked operating guide and conversion companion</li></ol><details><summary>Read the full report and conversion guide</summary><pre>'+esc(guide)+'</pre></details></body></html>';
}
export function previewReportDocument(name,source){return reportOpening(name,source)??documentPreview(name,source);}
function reportDocumentPreview(name,source){return reportOpening(name,source)??originalDocumentPreview(name,source);}
export function renderCompactCustomerDocumentViewer(options,format={}){
 let html=renderCustomerDocumentViewer(options,format);
 const original=documentPreview.toString(),escaped=original.replace(/<\/script/gi,"<\\/script");
 if(html.split(escaped).length!==2)throw Error("The original document preview changed.");
 const replacement=original.replace(/^function documentPreview\(/,"function originalDocumentPreview(")+"\n"+reportOpening.toString()+"\n"+reportDocumentPreview.toString().replace(/^function reportDocumentPreview\(/,"function documentPreview(");
 html=html.replace(escaped,()=>replacement.replace(/<\/script/gi,"<\\/script"));
 const marker="const b=unbase(p.payload);";
 if(html.split(marker).length!==2)throw Error("The original package decoder changed; preserve the complete renderer before integration.");
 return html.replace(marker,()=>'const b=p.payload_encoding==="latin1-json"?Uint8Array.from(p.payload,c=>{const n=c.charCodeAt(0);if(n>255)throw Error("Invalid original archive byte.");return n;}):unbase(p.payload);');
}
