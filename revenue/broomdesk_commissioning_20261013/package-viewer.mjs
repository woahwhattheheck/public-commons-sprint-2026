// Complete BroomDeskCommissioning package view using the unchanged 6A62 document viewer.
import {renderCustomerPackagePanel,documentPreview} from "./vendor/customer-package-panel.mjs";
const root="broomdesk-commissioning-complete-customer-packages";
const style=String.raw`
#broomdesk-commissioning-complete-customer-packages{color-scheme:light;box-sizing:border-box;font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;margin:0;padding:1.2rem;min-width:0}
#broomdesk-commissioning-complete-customer-packages *{box-sizing:border-box}
#broomdesk-commissioning-complete-customer-packages h1{font-size:1.4rem;line-height:1.3;margin:0 0 .5rem;color:#171717}
#broomdesk-commissioning-complete-customer-packages h2{font-size:1.05rem;line-height:1.4;margin:0;overflow-wrap:anywhere;color:#171717}
#broomdesk-commissioning-complete-customer-packages section{border:1px solid #aaa;padding:1rem;margin:1rem 0;background:#fff;color:#171717;min-width:0}
#broomdesk-commissioning-complete-customer-packages button{border:1px solid #333;background:#222;color:#fff;padding:.6rem .8rem;cursor:pointer;border-radius:2px;font:inherit;min-height:44px;max-width:100%;overflow-wrap:anywhere}
#broomdesk-commissioning-complete-customer-packages button.secondary{background:#fff;color:#222}
#broomdesk-commissioning-complete-customer-packages button:disabled{background:#eee;color:#555;cursor:default}
#broomdesk-commissioning-complete-customer-packages button:focus-visible,#broomdesk-commissioning-complete-customer-packages select:focus-visible{outline:3px solid #333;outline-offset:2px}
#broomdesk-commissioning-complete-customer-packages p{margin:.6rem 0;color:#171717;overflow-wrap:anywhere}
#broomdesk-commissioning-complete-customer-packages label{display:block;margin:.85rem 0 .25rem;color:#171717}
#broomdesk-commissioning-complete-customer-packages select{width:100%;max-width:100%;min-height:44px;padding:.5rem;background:#fff;color:#171717;border:1px solid #777;font:inherit}
#broomdesk-commissioning-complete-customer-packages option{background:#fff;color:#171717}
#broomdesk-commissioning-complete-customer-packages .controls{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.65rem}
#broomdesk-commissioning-complete-customer-packages .preview-head{display:flex;justify-content:space-between;gap:1rem;align-items:start}
#broomdesk-commissioning-complete-customer-packages iframe{display:block;width:100%;height:680px;border:1px solid #aaa;margin-top:1rem;background:#fff}
#broomdesk-commissioning-complete-customer-packages #document-preview[hidden]{display:none!important}
@media(max-width:480px){#broomdesk-commissioning-complete-customer-packages{padding:.7rem}#broomdesk-commissioning-complete-customer-packages section{padding:.8rem}#broomdesk-commissioning-complete-customer-packages .preview-head{flex-direction:column}}
`;
export function renderCommissioningPreview(name,source){
 if(!/^desk\/(?:sample|paid)\/commissioning\.html$/.test(name))return null;
 const m=source.match(/<script id="desk-seed" type="application\/json">([\s\S]*?)<\/script>/);if(!m)throw Error("Complete pilot selection missing.");
 const seed=JSON.parse(m[1]);if(!Array.isArray(seed.companies)||!seed.edition_id)throw Error("Complete pilot selection differs.");
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const working=name.replace(/commissioning\.html$/,"blank-working.json"),companies=seed.companies.map(a=>"<li>"+esc(a.document.organization)+"</li>").join("");
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BroomDesk commissioning desk</title><style>html{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:20px;font:16px/1.55 system-ui;color:#23282d;background:#fff;overflow-wrap:anywhere}h1{font-size:24px;line-height:1.2}h2{font-size:19px}aside{border:1px solid #bfc5cb;padding:16px;background:#f6f7f8}li{margin:8px 0}code{white-space:normal;overflow-wrap:anywhere}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;min-height:44px;font-weight:600}</style></head><body data-broomdesk-commissioning-opening="complete"><h1>BroomDesk commissioning desk</h1><p>Complete editable local programme for '+seed.companies.length+' original company '+(seed.companies.length===1?"profile":"profiles")+'.</p><aside><h2>Open the working desk</h2><ol><li>Download the complete pack and extract the ZIP.</li><li>Open <code>'+esc(name)+'</code> in a browser.</li><li>Choose <strong>Open working file</strong> and receive <code>'+esc(working)+'</code>.</li></ol><p>Receive actual property, crew and dated visits, review recurring changes and original time, approve an exact payroll handover and save the complete working file.</p></aside><h2>Included company research</h2><ul>'+companies+'</ul><h2>Complete working views</h2><ol><li>Original company research and agreed pilot</li><li>Property and crew handoff</li><li>Original sources and reconciled row disposition</li><li>Dated visits and explicit recurring changes</li><li>Actual clock observations and approved payroll receiving</li><li>Current operating review and owner decision</li><li>Complete working file and readable handover</li><li>Source-linked operating guide</li></ol><details><summary>Read the full operating guide</summary><pre>'+esc(seed.guide)+'</pre></details></body></html>';
}
export function previewBroomDeskCommissioningDocument(name,source){
 return renderCommissioningPreview(name,source)??documentPreview(name,source);
}
function broomdeskCommissioningDocumentPreview(name,source){
 const opening=renderCommissioningPreview(name,source);
 return opening===null?originalDocumentPreview(name,source):opening;
}

export function renderBroomDeskCommissioningPackageViewer(input,{fragment=false}={}){
 if(input?.schema!=="commons.broomdesk-commissioning-complete-package-viewer.v1")throw Error("Select the complete BroomDeskCommissioning package input.");
 const rendered=renderCustomerPackagePanel({customer:"BroomDesk commissioning",envelope:input.envelope});
 const originalPreview=documentPreview.toString(),escapedPreview=originalPreview.replace(/<\/script/gi,"<\\/script");
 if(rendered.split(escapedPreview).length!==2)throw Error("The original document preview changed.");
 const replacement=originalPreview.replace(/^function documentPreview\(/,"function originalDocumentPreview(")+"\n"+
  renderCommissioningPreview.toString()+"\n"+broomdeskCommissioningDocumentPreview.toString().replace(/^function broomdeskCommissioningDocumentPreview\(/,"function documentPreview(");
 const original=rendered.replace(escapedPreview,replacement.replace(/<\/script/gi,"<\\/script"));
 const head=original.match(/<head>([\s\S]*?)<\/head>/),start=original.indexOf("<body>"),end=original.lastIndexOf("</body>");
 if(!head||start<0||end<=start)throw Error("The complete original viewer template changed.");
 const markup='<div id="'+root+'">'+original.slice(start+6,end)+"</div>";
 if(fragment)return "<style>"+style+"</style>"+markup;
 return '<!doctype html><html lang="en"><head>'+head[1].replace(/<style>[\s\S]*?<\/style>/,"<style>"+style+"</style>")+'</head><body style="margin:0">'+markup+"</body></html>\n";
}
