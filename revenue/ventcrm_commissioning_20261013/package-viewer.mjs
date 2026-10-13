// Complete VentCRM package view using the unchanged 6A62 document viewer.
import {renderCustomerPackagePanel,documentPreview} from "./vendor/customer-package-panel.mjs";
const root="ventcrm-complete-customer-packages";
const style=String.raw`
#ventcrm-complete-customer-packages{color-scheme:light;box-sizing:border-box;font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;margin:0;padding:1.2rem;min-width:0}
#ventcrm-complete-customer-packages *{box-sizing:border-box}
#ventcrm-complete-customer-packages h1{font-size:1.4rem;line-height:1.3;margin:0 0 .5rem;color:#171717}
#ventcrm-complete-customer-packages h2{font-size:1.05rem;line-height:1.4;margin:0;overflow-wrap:anywhere;color:#171717}
#ventcrm-complete-customer-packages section{border:1px solid #aaa;padding:1rem;margin:1rem 0;background:#fff;color:#171717;min-width:0}
#ventcrm-complete-customer-packages button{border:1px solid #333;background:#222;color:#fff;padding:.6rem .8rem;cursor:pointer;border-radius:2px;font:inherit;min-height:44px;max-width:100%;overflow-wrap:anywhere}
#ventcrm-complete-customer-packages button.secondary{background:#fff;color:#222}
#ventcrm-complete-customer-packages button:disabled{background:#eee;color:#555;cursor:default}
#ventcrm-complete-customer-packages button:focus-visible,#ventcrm-complete-customer-packages select:focus-visible{outline:3px solid #333;outline-offset:2px}
#ventcrm-complete-customer-packages p{margin:.6rem 0;color:#171717;overflow-wrap:anywhere}
#ventcrm-complete-customer-packages label{display:block;margin:.85rem 0 .25rem;color:#171717}
#ventcrm-complete-customer-packages select{width:100%;max-width:100%;min-height:44px;padding:.5rem;background:#fff;color:#171717;border:1px solid #777;font:inherit}
#ventcrm-complete-customer-packages option{background:#fff;color:#171717}
#ventcrm-complete-customer-packages .controls{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.65rem}
#ventcrm-complete-customer-packages .preview-head{display:flex;justify-content:space-between;gap:1rem;align-items:start}
#ventcrm-complete-customer-packages iframe{display:block;width:100%;height:680px;border:1px solid #aaa;margin-top:1rem;background:#fff}
#ventcrm-complete-customer-packages #document-preview[hidden]{display:none!important}
@media(max-width:480px){#ventcrm-complete-customer-packages{padding:.7rem}#ventcrm-complete-customer-packages section{padding:.8rem}#ventcrm-complete-customer-packages .preview-head{flex-direction:column}}
`;
export function renderCommissioningPreview(name,source){
 if(!/-commissioning\.html$/.test(name))return null;
 const match=source.match(/<script id="programme-data" type="application\/json">([\s\S]*?)<\/script>/);
 if(!match)throw Error("The original commissioning programme could not be read.");
 const data=JSON.parse(match[1]),seed=data.seed;
 if(seed?.version!=="ventcrm.commissioning-seed.v1"||!Array.isArray(seed.operators)||!Array.isArray(seed.criteria))
  throw Error("The original commissioning programme could not be read.");
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const working=name.replace(/-commissioning\.html$/,"-working.json");
 if(working===name)throw Error("The original commissioning filename is not recognized.");
 const operators=seed.operators.map(x=>"<li>"+esc(x.company||x.id)+"</li>").join("");
 const steps=seed.criteria.map(x=>"<li><h3>"+esc(x.title)+"</h3><p>"+esc(x.action||x.instruction)+"</p>"+(x.acceptance?"<p><strong>Review outcome:</strong> "+esc(x.acceptance)+"</p>":"")+(x.retain?"<p><strong>Retain:</strong> "+esc(x.retain)+"</p>":"")+"</li>").join("");
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(seed.title)+'</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{font:15px/1.55 system-ui,sans-serif;margin:0;padding:1rem;color:#171717;background:#fff;overflow-wrap:anywhere}h1{font-size:1.25rem;line-height:1.3}h2{font-size:1.05rem;margin-top:1.4rem}h3{font-size:1rem;margin-bottom:.3rem}p{margin:.5rem 0;max-width:75ch}code{font:inherit;font-weight:600}aside{border:1px solid #aaa;background:#f5f5f5;padding:1rem}ol,ul{padding-left:1.5rem}li{margin:.45rem 0}details{border-top:1px solid #aaa;margin-top:1.2rem;padding-top:.9rem}summary{cursor:pointer;font-weight:600;min-height:44px}summary:focus-visible{outline:3px solid #333;outline-offset:3px}</style></head><body data-ventcrm-opening="complete"><h1>'+esc(seed.title)+'</h1><p>This package contains a complete editable commissioning desk for '+seed.operators.length+' '+(seed.operators.length===1?'selected operator':'selected operators')+'.</p><aside><h2>Open the working desk</h2><ol><li>Choose <strong>Download complete pack</strong> in the package controls and extract the ZIP.</li><li>Open <code>'+esc(name)+'</code> in your browser.</li><li>Choose <strong>Open working JSON</strong> and select <code>'+esc(working)+'</code> from the same extracted package.</li><li>Review the received programme, then choose <strong>Open this complete working copy</strong>.</li><li>On the intended operator\'s profile, choose <strong>Open commissioning plan</strong>.</li><li>Enter the <strong>Person recording changes</strong> and complete Setup. This name is recorded when you save changes.</li></ol><p>Then edit setup, source registers and review steps; save the complete working JSON to continue later. The document preview keeps the original programme and opening instructions together.</p></aside><h2>Included operators</h2><ul>'+operators+'</ul><details><summary>View the '+seed.criteria.length+' original commissioning steps</summary><ol>'+steps+'</ol></details></body></html>';
}
export function previewVentCRMDocument(name,source){
 return renderCommissioningPreview(name,source)??documentPreview(name,source);
}
function ventcrmDocumentPreview(name,source){
 const opening=renderCommissioningPreview(name,source);
 return opening===null?originalDocumentPreview(name,source):opening;
}

export function bindVentCRMProfileNavigation(frame){
 frame.addEventListener("load",()=>{
  const doc=frame.contentDocument;if(!doc)return;
  doc.addEventListener("click",event=>{
   const link=event.target.closest?.("a[href]"),href=link?.getAttribute("href");
   if(!href?.startsWith("#"))return;
   event.preventDefault();
   let id=href.slice(1);try{id=decodeURIComponent(id);}catch{}
   const target=id?doc.getElementById(id)||Array.from(doc.getElementsByName(id)).find(el=>el.tagName==="A"):doc.documentElement;
   if(!target)return;
   target.scrollIntoView({block:"start"});
   if(!target.hasAttribute("tabindex")){
    target.setAttribute("tabindex","-1");
    target.addEventListener("blur",()=>target.removeAttribute("tabindex"),{once:true});
   }
   target.focus({preventScroll:true});
  });
 });
}

export function renderVentCRMPackageViewer(input,{fragment=false}={}){
 if(input?.schema!=="commons.ventcrm-complete-package-viewer.v1")throw Error("Select the complete VentCRM package input.");
 const rendered=renderCustomerPackagePanel({customer:"VentCRM",envelope:input.envelope});
 const originalPreview=documentPreview.toString(),escapedPreview=originalPreview.replace(/<\/script/gi,"<\\/script");
 if(rendered.split(escapedPreview).length!==2)throw Error("The original document preview changed.");
 const replacement=originalPreview.replace(/^function documentPreview\(/,"function originalDocumentPreview(")+"\n"+
  renderCommissioningPreview.toString()+"\n"+ventcrmDocumentPreview.toString().replace(/^function ventcrmDocumentPreview\(/,"function documentPreview(");
 const previewed=rendered.replace(escapedPreview,replacement.replace(/<\/script/gi,"<\\/script"));
 const endScript=previewed.lastIndexOf("</script>");
 if(endScript<0||!previewed.slice(0,endScript).endsWith("packagePanelMain();"))throw Error("The complete original viewer runtime changed.");
 const navigation="\n"+bindVentCRMProfileNavigation.toString()+"\nbindVentCRMProfileNavigation(document.getElementById(\"preview\"));";
 const original=previewed.slice(0,endScript)+navigation.replace(/<\/script/gi,"<\\/script")+previewed.slice(endScript);
 const head=original.match(/<head>([\s\S]*?)<\/head>/),start=original.indexOf("<body>"),end=original.lastIndexOf("</body>");
 if(!head||start<0||end<=start)throw Error("The complete original viewer template changed.");
 const markup='<div id="'+root+'">'+original.slice(start+6,end)+"</div>";
 if(fragment)return "<style>"+style+"</style>"+markup;
 return '<!doctype html><html lang="en"><head>'+head[1].replace(/<style>[\s\S]*?<\/style>/,"<style>"+style+"</style>")+'</head><body style="margin:0">'+markup+"</body></html>\n";
}
