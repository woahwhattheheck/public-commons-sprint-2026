// Complete MapRankPilot package view using the unchanged 6A62 document viewer.
import {renderCustomerPackagePanel,documentPreview} from "./vendor/customer-package-panel.mjs";
const root="maprank-pilot-complete-customer-packages";
const style=String.raw`
#maprank-pilot-complete-customer-packages{color-scheme:light;box-sizing:border-box;font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;margin:0;padding:1.2rem;min-width:0}
#maprank-pilot-complete-customer-packages *{box-sizing:border-box}
#maprank-pilot-complete-customer-packages h1{font-size:1.4rem;line-height:1.3;margin:0 0 .5rem;color:#171717}
#maprank-pilot-complete-customer-packages h2{font-size:1.05rem;line-height:1.4;margin:0;overflow-wrap:anywhere;color:#171717}
#maprank-pilot-complete-customer-packages section{border:1px solid #aaa;padding:1rem;margin:1rem 0;background:#fff;color:#171717;min-width:0}
#maprank-pilot-complete-customer-packages button{border:1px solid #333;background:#222;color:#fff;padding:.6rem .8rem;cursor:pointer;border-radius:2px;font:inherit;min-height:44px;max-width:100%;overflow-wrap:anywhere}
#maprank-pilot-complete-customer-packages button.secondary{background:#fff;color:#222}
#maprank-pilot-complete-customer-packages button:disabled{background:#eee;color:#555;cursor:default}
#maprank-pilot-complete-customer-packages button:focus-visible,#maprank-pilot-complete-customer-packages select:focus-visible{outline:3px solid #333;outline-offset:2px}
#maprank-pilot-complete-customer-packages p{margin:.6rem 0;color:#171717;overflow-wrap:anywhere}
#maprank-pilot-complete-customer-packages label{display:block;margin:.85rem 0 .25rem;color:#171717}
#maprank-pilot-complete-customer-packages select{width:100%;max-width:100%;min-height:44px;padding:.5rem;background:#fff;color:#171717;border:1px solid #777;font:inherit}
#maprank-pilot-complete-customer-packages option{background:#fff;color:#171717}
#maprank-pilot-complete-customer-packages .controls{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.65rem}
#maprank-pilot-complete-customer-packages .preview-head{display:flex;justify-content:space-between;gap:1rem;align-items:start}
#maprank-pilot-complete-customer-packages iframe{display:block;width:100%;height:680px;border:1px solid #aaa;margin-top:1rem;background:#fff}
#maprank-pilot-complete-customer-packages #document-preview[hidden]{display:none!important}
@media(max-width:480px){#maprank-pilot-complete-customer-packages{padding:.7rem}#maprank-pilot-complete-customer-packages section{padding:.8rem}#maprank-pilot-complete-customer-packages .preview-head{flex-direction:column}}
`;
export function renderPilotPreview(name,source){
 if(!/\/(?:sample|paid)-desk\.html$/.test(name))return null;
 const m=source.match(/<script id="pilot-seed" type="application\/json">([\s\S]*?)<\/script>/);if(!m)throw Error("Complete pilot selection missing.");
 const seed=JSON.parse(m[1]);if(!Array.isArray(seed.agencies)||!seed.edition_id)throw Error("Complete pilot selection differs.");
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const working=name.replace(/-desk\.html$/,"-working.json"),agencies=seed.agencies.map(a=>"<li>"+esc(a.document.organization)+"</li>").join("");
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MapRank agency pilot desk</title><style>html{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:20px;font:16px/1.55 system-ui;color:#23282d;background:#fff;overflow-wrap:anywhere}h1{font-size:24px;line-height:1.2}h2{font-size:19px}aside{border:1px solid #bfc5cb;padding:16px;background:#f6f7f8}li{margin:8px 0}code{white-space:normal;overflow-wrap:anywhere}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;min-height:44px;font-weight:600}</style></head><body data-maprank-pilot-opening="complete"><h1>MapRank agency pilot desk</h1><p>Complete editable local programme for '+seed.agencies.length+' original agency '+(seed.agencies.length===1?"profile":"profiles")+'.</p><aside><h2>Open the working desk</h2><ol><li>Download the complete pack and extract the ZIP.</li><li>Open <code>'+esc(name)+'</code> in a browser.</li><li>Choose <strong>Open working file</strong> and receive <code>'+esc(working)+'</code>.</li></ol><p>Plan the actual client/location, account and keyword scope, receive original results, review the client decision and save the whole editable working file.</p></aside><h2>Included agency research</h2><ul>'+agencies+'</ul><h2>Complete working views</h2><ol><li>Agency research and selected customer scope</li><li>Actual client and physical location</li><li>Observed account entitlement and immutable scope versions</li><li>Original attachments and source-qualified results</li><li>Comparable metrics, actions and actual client decision</li><li>Client-selected handover and complete editable receiving</li><li>Source-linked operating guide</li></ol><details><summary>Read the full operating and metric guide</summary><pre>'+esc(seed.guide)+'</pre></details></body></html>';
}
export function previewMapRankPilotDocument(name,source){
 return renderPilotPreview(name,source)??documentPreview(name,source);
}
function maprankPilotDocumentPreview(name,source){
 const opening=renderPilotPreview(name,source);
 return opening===null?originalDocumentPreview(name,source):opening;
}

export function renderMapRankPilotPackageViewer(input,{fragment=false}={}){
 if(input?.schema!=="commons.maprank-pilot-complete-package-viewer.v1")throw Error("Select the complete MapRankPilot package input.");
 const rendered=renderCustomerPackagePanel({customer:"MapRank agency pilot",envelope:input.envelope});
 const originalPreview=documentPreview.toString(),escapedPreview=originalPreview.replace(/<\/script/gi,"<\\/script");
 if(rendered.split(escapedPreview).length!==2)throw Error("The original document preview changed.");
 const replacement=originalPreview.replace(/^function documentPreview\(/,"function originalDocumentPreview(")+"\n"+
  renderPilotPreview.toString()+"\n"+maprankPilotDocumentPreview.toString().replace(/^function maprankPilotDocumentPreview\(/,"function documentPreview(");
 const original=rendered.replace(escapedPreview,replacement.replace(/<\/script/gi,"<\\/script"));
 const head=original.match(/<head>([\s\S]*?)<\/head>/),start=original.indexOf("<body>"),end=original.lastIndexOf("</body>");
 if(!head||start<0||end<=start)throw Error("The complete original viewer template changed.");
 const markup='<div id="'+root+'">'+original.slice(start+6,end)+"</div>";
 if(fragment)return "<style>"+style+"</style>"+markup;
 return '<!doctype html><html lang="en"><head>'+head[1].replace(/<style>[\s\S]*?<\/style>/,"<style>"+style+"</style>")+'</head><body style="margin:0">'+markup+"</body></html>\n";
}
